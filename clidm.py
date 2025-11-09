#!/usr/bin/env python3
"""
clidm — unified HTTP + BitTorrent CLI download manager
-------------------------------------------------------
Supports:
  ✅ HTTP/HTTPS (segmented)
  ✅ Magnet links
  ✅ .torrent files (local or remote URLs)
  ✅ Resume support
  ✅ Rate limiting
  ✅ Sequential mode for torrents
  ✅ Upload/download limits for BitTorrent
  ✅ SHA256 verification (HTTP)
  ✅ Cross-platform libtorrent detection

To install dependencies:
  pip install -r requirements.txt
"""

import argparse
import asyncio
import hashlib
import json
import math
import re
import signal
import sys
import time
from pathlib import Path
from typing import Optional, Dict

import aiohttp

# ---------- Optional torrent import ----------
LT_AVAILABLE = False

try:
    import libtorrent as lt
    LT_AVAILABLE = True
except Exception:
    try:
        import python_libtorrent as lt
        LT_AVAILABLE = True
    except Exception:
        LT_AVAILABLE = False

# ---------- Helpers ----------

def human_bytes(n: float) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    while n >= 1024 and i < len(units) - 1:
        n /= 1024
        i += 1
    return f"{n:.2f}{units[i]}"


def parse_bytes(s: str) -> int:
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*([kKmMgGtT]?[bB]?)?\s*$", s)
    if not m:
        raise argparse.ArgumentTypeError(f"Invalid size: {s}")
    val = float(m.group(1))
    unit = (m.group(2) or "").lower()

    if unit in ("k", "kb"):
        return int(val * 1024)
    if unit in ("m", "mb"):
        return int(val * 1024 ** 2)
    if unit in ("g", "gb"):
        return int(val * 1024 ** 3)
    if unit in ("t", "tb"):
        return int(val * 1024 ** 4)
    return int(val)


def parse_header(h: str):
    if ":" not in h:
        raise argparse.ArgumentTypeError("Header must be in 'Name: value' format")
    k, v = h.split(":", 1)
    return (k.strip(), v.strip())


def pick_filename(url: str, headers: Dict[str, str], output: Optional[str]) -> str:
    if output:
        return output
    cd = headers.get("Content-Disposition") or headers.get("content-disposition")
    if cd:
        m = re.search(r'filename="([^"]+)"', cd)
        if m:
            return m.group(1)
    return url.split("/")[-1]


def is_torrent_like(src: str) -> bool:
    if src.startswith("magnet:"):
        return True
    if Path(src).exists() and src.lower().endswith(".torrent"):
        return True
    if src.lower().startswith("http") and src.lower().endswith(".torrent"):
        return True
    return False

# ---------- Rate limiter ----------
class TokenBucket:
    def __init__(self, rate):
        self.rate = rate
        self.tokens = 0
        self.last = time.time()
        self.lock = asyncio.Lock()

    async def consume(self, n):
        if not self.rate:
            return

        async with self.lock:
            while True:
                now = time.time()
                self.tokens += (now - self.last) * self.rate
                self.last = now
                if self.tokens > self.rate:
                    self.tokens = self.rate
                if self.tokens >= n:
                    self.tokens -= n
                    return
                await asyncio.sleep(0.1)

# ---------- Persistent state (HTTP resume) ----------
class State:
    def __init__(self, path: Path):
        self.path = path
        self.data = {}
        if path.exists():
            try:
                self.data = json.loads(path.read_text())
            except:
                self.data = {}

    def save(self):
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2))
        tmp.replace(self.path)

# ---------- HTTP Downloader ----------
class DownloaderHTTP:
    def __init__(self, url: str, out: Path, chunk: int, conns: int,
                 limit: int, headers, proxy, retries, cto, rto, sha256, quiet):

        self.url = url
        self.out = out
        self.chunk_size = chunk
        self.concurrency = conns
        self.limit = TokenBucket(limit)
        self.headers = headers
        self.proxy = proxy
        self.retries = retries
        self.connect_timeout = cto
        self.read_timeout = rto
        self.verify_sha256 = sha256
        self.quiet = quiet

        self.session = None
        self.accept_ranges = False
        self.total_size = None
        self.etag = None

        self.state_path = out.parent / f".{out.name}.clidm.json"
        self.state = State(self.state_path)

        self.progress_downloaded = 0
        self.progress_total = 0
        self.chunks = []

    async def _init_session(self):
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=None,
                                         connect=self.connect_timeout,
                                         sock_read=self.read_timeout),
            headers=dict(self.headers),
            trust_env=True
        )

    async def _probe(self):
        # Get headers
        async with self.session.head(self.url, proxy=self.proxy, allow_redirects=True) as r:
            if "Content-Length" in r.headers:
                self.total_size = int(r.headers.get("Content-Length"))
            if "Accept-Ranges" in r.headers:
                self.accept_ranges = r.headers.get("Accept-Ranges") == "bytes"
            self.etag = r.headers.get("ETag")

        # If no size, try GET
        if not self.total_size:
            async with self.session.get(self.url, proxy=self.proxy) as r:
                self.total_size = int(r.headers.get("Content-Length", 0))

        # Determine filename
        async with self.session.get(self.url, proxy=self.proxy,
                                    headers={"Range": "bytes=0-0"}) as r:
            name = pick_filename(self.url, r.headers, None)
            self.out = self.out.parent / name

        # Setup chunk ranges
        if self.accept_ranges and self.total_size:
            count = math.ceil(self.total_size / self.chunk_size)
            self.chunks = [(i * self.chunk_size,
                            min((i + 1) * self.chunk_size - 1, self.total_size - 1))
                           for i in range(count)]
            self.progress_total = self.total_size
        else:
            self.chunks = [(0, None)]

    def _draw(self):
        if self.quiet: return
        if not self.progress_total:
            print(f"\r{human_bytes(self.progress_downloaded)}...", end="")
        else:
            pct = self.progress_downloaded / self.progress_total * 100
            bar = "#" * int(pct / 3) + "-" * (33 - int(pct / 3))
            print(f"\r[{bar}] {pct:.2f}% {human_bytes(self.progress_downloaded)}/{human_bytes(self.progress_total)}", end="")

    async def _fetch(self, start, end, wid):
        dest = Path(f"{self.out}.part.{start}.{end}")
        offset = dest.stat().st_size if dest.exists() else 0
        rs = start + offset
        headers = {}
        if end is not None:
            headers["Range"] = f"bytes={rs}-{end}"
        elif offset > 0:
            headers["Range"] = f"bytes={rs}-"

        attempt = 0
        while True:
            try:
                async with self.session.get(self.url, proxy=self.proxy, headers=headers) as r:
                    r.raise_for_status()
                    with open(dest, "ab") as f:
                        async for chunk in r.content.iter_chunked(65536):
                            await self.limit.consume(len(chunk))
                            f.write(chunk)
                            self.progress_downloaded += len(chunk)
                            self._draw()
                return
            except Exception:
                attempt += 1
                if attempt > self.retries:
                    raise
                await asyncio.sleep(0.5 * (2 ** attempt))

    async def _assemble(self):
        if not self.accept_ranges:
            single = Path(f"{self.out}.part.0.None")
            if single.exists():
                single.rename(self.out)
            return

        with open(self.out, "wb") as w:
            for (s, e) in self.chunks:
                part = Path(f"{self.out}.part.{s}.{e}")
                with open(part, "rb") as f:
                    w.write(f.read())
                part.unlink(missing_ok=True)

    async def download(self):
        await self._init_session()
        await self._probe()

        if not self.accept_ranges:
            await self._fetch(0, None, 1)
        else:
            sem = asyncio.Semaphore(self.concurrency)
            pending = list(self.chunks)

            async def worker(i):
                while pending:
                    async with sem:
                        (s, e) = pending.pop(0)
                    await self._fetch(s, e, i)

            await asyncio.gather(*(worker(i) for i in range(self.concurrency)))

        await self._assemble()

        if self.verify_sha256:
            h = hashlib.sha256()
            with open(self.out, "rb") as f:
                while True:
                    chunk = f.read(1 << 20)
                    if not chunk:
                        break
                    h.update(chunk)
            if h.hexdigest().lower() != self.verify_sha256.lower():
                raise RuntimeError("SHA256 mismatch")

        print(f"\n✅ Saved: {self.out}")

# ---------- Torrent Downloader ----------
class DownloaderTorrent:
    def __init__(self, src, out: Path, dl_limit, ul_limit, sequential, quiet):
        if not LT_AVAILABLE:
            raise RuntimeError("libtorrent/python-libtorrent not installed")

        self.src = src
        self.out = out
        self.dl_limit = dl_limit or 0
        self.ul_limit = ul_limit or 0
        self.seq = sequential
        self.quiet = quiet

    async def download(self):
        ses = lt.session()

        try:
            ses.listen_on(6881, 6891)
        except:
            try:
                ses.apply_settings({"listen_interfaces": "0.0.0.0:6881"})
            except:
                pass

        ses.start_dht()

        if self.dl_limit:
            ses.set_download_rate_limit(self.dl_limit)
        if self.ul_limit:
            ses.set_upload_rate_limit(self.ul_limit)

        params = {
            "save_path": str(self.out if self.out.is_dir() else self.out.parent),
            "storage_mode": lt.storage_mode_t.storage_mode_sparse \
                if hasattr(lt, "storage_mode_t") else 0,
        }

        if self.src.startswith("magnet:"):
            h = lt.add_magnet_uri(ses, self.src, params)
        else:
            if self.src.startswith("http"):
                data = await self._fetch(self.src)
                info = lt.torrent_info(lt.bdecode(data))
            else:
                info = lt.torrent_info(self.src)
            params["ti"] = info
            h = ses.add_torrent(params)

        if self.seq:
            h.set_sequential_download(True)

        while not h.has_metadata():
            await asyncio.sleep(1)

        last = 0
        while True:
            s = h.status()
            prog = s.progress * 100
            down = s.download_rate
            up = s.upload_rate

            now = time.time()
            if not self.quiet and now - last > 0.5:
                bar = "#" * int(prog / 3) + "-" * (33 - int(prog / 3))
                print(f"\r[{bar}] {prog:.2f}% ↓{human_bytes(down)}/s ↑{human_bytes(up)}/s peers:{s.num_peers}", end="")
                last = now

            if s.is_seeding:
                break
            await asyncio.sleep(0.5)

        print("\n✅ Torrent complete")

    async def _fetch(self, url):
        async with aiohttp.ClientSession() as s:
            async with s.get(url) as r:
                return await r.read()

# ---------- CLI ----------

def main():
    ap = argparse.ArgumentParser(prog="clidm", description="Unified HTTP + Torrent downloader")
    ap.add_argument("source", help="URL, magnet link, or .torrent file")
    ap.add_argument("-o", "--output", help="Output file or directory")

    # HTTP options
    ap.add_argument("-c", "--connections", type=int, default=8)
    ap.add_argument("-C", "--chunk-size", type=parse_bytes, default=parse_bytes("4MB"))
    ap.add_argument("--limit", type=parse_bytes)
    ap.add_argument("-H", "--header", action="append", type=parse_header, default=[])
    ap.add_argument("--proxy")
    ap.add_argument("--retries", type=int, default=5)
    ap.add_argument("--connect-timeout", type=int, default=15)
    ap.add_argument("--read-timeout", type=int, default=60)
    ap.add_argument("--sha256")

    # Torrent-specific
    ap.add_argument("--bt-upload-limit", type=parse_bytes)
    ap.add_argument("--bt-sequential", action="store_true")

    ap.add_argument("-q", "--quiet", action="store_true")

    args = ap.parse_args()
    loop = asyncio.get_event_loop()

    # Handle CTRL+C nicely
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, lambda: (_ for _ in ()).throw(KeyboardInterrupt()))
        except:
            pass

    src = args.source
    out = Path(args.output) if args.output else Path.cwd()

    try:
        if is_torrent_like(src):
            dl = DownloaderTorrent(
                src,
                out,
                args.limit,
                args.bt_upload_limit,
                args.bt_sequential,
                args.quiet
            )
            loop.run_until_complete(dl.download())
        else:
            if out.is_dir():
                out = out / "download.tmp"
            dl = DownloaderHTTP(
                src,
                out,
                args.chunk_size,
                args.connections,
                args.limit,
                args.header,
                args.proxy,
                args.retries,
                args.connect_timeout,
                args.read_timeout,
                args.sha256,
                args.quiet
            )
            loop.run_until_complete(dl.download())
    except KeyboardInterrupt:
        print("\nInterrupted. Resume supported.")
    except Exception as e:
        print(f"\nError: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()