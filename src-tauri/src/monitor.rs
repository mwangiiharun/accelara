// Watches the on-disk location of seeding torrents so a folder move/rename
// can be detected without the user having to tell us. Everything here is
// in-memory only (no DB writes) - seeding is a live/display concept, not
// persisted state.
//
// How detection works, and its real limits:
// - We watch the *parent* directory of each seeding torrent's file/folder
//   (non-recursive - we only care about that one entry).
// - A rename within the same parent (or into another directory we already
//   happen to be watching) arrives as a single paired rename event with both
//   the old and new path, so we can react and re-point the seed immediately.
// - A move to a directory we have no reason to be watching is invisible to
//   any OS-level watcher - by definition, nothing is watching it. In that
//   case we only see the file disappear, so we mark the download
//   `missing_files` and let the user manually relink it.
// - A plain rename (name changes, not just location) also can't be resumed
//   automatically: the torrent library expects the file/folder to keep the
//   name recorded in the torrent's own metadata. We treat that the same as
//   "missing" rather than pretending to recover it.

use crate::commands;
use crate::logger;
use notify::event::{ModifyKind, RenameMode};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::Mutex;

struct WatchState {
    watcher: RecommendedWatcher,
    // parent directory -> number of tracked downloads living directly under it
    parent_refs: HashMap<PathBuf, usize>,
    // download_id -> exact path currently being tracked
    tracked: HashMap<String, PathBuf>,
    // exact path -> download_id (reverse lookup for incoming fs events)
    path_to_id: HashMap<PathBuf, String>,
}

lazy_static::lazy_static! {
    static ref STATE: Arc<Mutex<Option<WatchState>>> = Arc::new(Mutex::new(None));
}

/// Start the background watcher. Call once at app startup.
pub fn init(app: AppHandle) {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Event>();

    let watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            let _ = tx.send(event);
        }
    });

    let watcher = match watcher {
        Ok(w) => w,
        Err(e) => {
            logger::log_error("monitor", &format!("Failed to create file watcher: {}", e));
            return;
        }
    };

    tauri::async_runtime::spawn(async move {
        {
            let mut guard = STATE.lock().await;
            *guard = Some(WatchState {
                watcher,
                parent_refs: HashMap::new(),
                tracked: HashMap::new(),
                path_to_id: HashMap::new(),
            });
        }

        while let Some(event) = rx.recv().await {
            handle_event(app.clone(), event).await;
        }
    });
}

/// Start (or move) the watch for a download's seeded file/folder.
pub async fn start_watching(download_id: &str, path: &Path) {
    let mut guard = STATE.lock().await;
    let state = match guard.as_mut() {
        Some(s) => s,
        None => return,
    };

    stop_watching_locked(state, download_id);

    let parent = match path.parent() {
        Some(p) => p.to_path_buf(),
        None => return,
    };

    let refcount = state.parent_refs.entry(parent.clone()).or_insert(0);
    if *refcount == 0 {
        if let Err(e) = state.watcher.watch(&parent, RecursiveMode::NonRecursive) {
            logger::log_warning(
                "monitor",
                &format!("Could not watch {} for moves: {}", parent.display(), e),
            );
            return;
        }
    }
    *refcount += 1;

    state.tracked.insert(download_id.to_string(), path.to_path_buf());
    state.path_to_id.insert(path.to_path_buf(), download_id.to_string());
}

/// Stop watching a download (on pause/stop/remove, or once we've handed it
/// off to a relocation).
pub async fn stop_watching(download_id: &str) {
    let mut guard = STATE.lock().await;
    if let Some(state) = guard.as_mut() {
        stop_watching_locked(state, download_id);
    }
}

fn stop_watching_locked(state: &mut WatchState, download_id: &str) {
    if let Some(path) = state.tracked.remove(download_id) {
        state.path_to_id.remove(&path);
        if let Some(parent) = path.parent() {
            if let Some(count) = state.parent_refs.get_mut(parent) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    let _ = state.watcher.unwatch(parent);
                    state.parent_refs.remove(parent);
                }
            }
        }
    }
}

/// The path currently believed to hold a seeding download's data, if any.
/// This is the in-memory source of truth used by the move/relink commands -
/// nothing about it lives in the database.
pub async fn get_tracked_path(download_id: &str) -> Option<PathBuf> {
    let guard = STATE.lock().await;
    guard.as_ref()?.tracked.get(download_id).cloned()
}

async fn handle_event(app: AppHandle, event: Event) {
    match event.kind {
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if event.paths.len() == 2 => {
            handle_rename(app, &event.paths[0], &event.paths[1]).await;
        }
        EventKind::Remove(_) => {
            for path in event.paths {
                handle_possible_disappearance(app.clone(), path).await;
            }
        }
        _ => {}
    }
}

async fn handle_rename(app: AppHandle, from: &Path, to: &Path) {
    let download_id = {
        let guard = STATE.lock().await;
        match guard.as_ref() {
            Some(state) => state.path_to_id.get(from).cloned(),
            None => None,
        }
    };
    let download_id = match download_id {
        Some(id) => id,
        None => return,
    };

    // A genuine rename of the top-level entry (not just relocation) breaks
    // the torrent's own expectation of its file/folder name - the torrent
    // library won't recognize the renamed data as belonging to it, so
    // resuming seeding in place isn't possible. Treat that as missing.
    if from.file_name() != to.file_name() {
        logger::log_warning(
            "monitor",
            &format!(
                "{} was renamed ({} -> {}), not just moved - can't auto-resume seeding",
                download_id,
                from.display(),
                to.display()
            ),
        );
        let _ = commands::mark_download_missing(&app, &download_id).await;
        return;
    }

    let new_parent = match to.parent() {
        Some(p) => p.to_path_buf(),
        None => return,
    };

    logger::log_info(
        "monitor",
        &format!(
            "Detected move for {}: {} -> {}",
            download_id,
            from.display(),
            to.display()
        ),
    );

    if let Err(e) = commands::repoint_and_restart(&app, &download_id, &new_parent).await {
        logger::log_error(
            "monitor",
            &format!("Auto-relocate failed for {}: {}", download_id, e),
        );
    }
}

async fn handle_possible_disappearance(app: AppHandle, path: PathBuf) {
    let download_id = {
        let guard = STATE.lock().await;
        match guard.as_ref() {
            Some(state) => state.path_to_id.get(&path).cloned(),
            None => None,
        }
    };
    let download_id = match download_id {
        Some(id) => id,
        None => return,
    };

    // Give a paired rename-to event (handled above) a chance to arrive and
    // re-home this download before we declare it missing.
    tokio::time::sleep(Duration::from_millis(1500)).await;

    let still_missing = {
        let guard = STATE.lock().await;
        match guard.as_ref() {
            Some(state) => {
                matches!(state.tracked.get(&download_id), Some(p) if p == &path) && !path.exists()
            }
            None => false,
        }
    };

    if still_missing {
        logger::log_warning(
            "monitor",
            &format!(
                "{} disappeared from {} with no detectable destination",
                download_id,
                path.display()
            ),
        );
        let _ = commands::mark_download_missing(&app, &download_id).await;
    }
}
