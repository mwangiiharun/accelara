#!/usr/bin/env python3
"""
API Wrapper for ACCELARA Electron GUI
Provides JSON output for download status updates
"""

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

# Import the main downloader classes
sys.path.insert(0, str(Path(__file__).parent))
from clidm import DownloaderHTTP, DownloaderTorrent, is_torrent_like, human_bytes, parse_bytes as parse_bytes_clidm

class StatusReporter:
    def __init__(self, download_id):
        self.download_id = download_id
        self.start_time = time.time()
        self.last_update = 0
        
    def report(self, status_data):
        """Report status as JSON to stdout"""
        now = time.time()
        if now - self.last_update < 0.1:  # Throttle to 10 updates/sec
            return
        self.last_update = now
        
        output = {
            'download_id': self.download_id,
            'timestamp': now,
            **status_data
        }
        print(json.dumps(output), flush=True)

async def download_with_status(source, output, download_id, options):
    """Download with status reporting"""
    reporter = StatusReporter(download_id)
    out_path = Path(output)
    
    try:
        if is_torrent_like(source):
            # Torrent download
            from clidm import LT_AVAILABLE
            if not LT_AVAILABLE:
                reporter.report({
                    'type': 'error',
                    'message': 'libtorrent not available'
                })
                return
            
            dl = DownloaderTorrent(
                source,
                out_path,
                options.get('limit'),
                options.get('bt_upload_limit'),
                options.get('bt_sequential', False),
                quiet=True
            )
            
            # We need to modify the torrent downloader to report status
            # For now, create a wrapper
            await download_torrent_with_status(dl, reporter)
        else:
            # HTTP download
            if out_path.is_dir():
                out_path = out_path / "download.tmp"
            
            chunk_size = options.get('chunk_size', '4MB')
            if isinstance(chunk_size, str):
                chunk_size = parse_bytes_clidm(chunk_size)
            elif chunk_size is None:
                chunk_size = parse_bytes_clidm('4MB')
            
            dl = DownloaderHTTP(
                source,
                out_path,
                chunk_size,
                options.get('concurrency', 8),
                options.get('limit'),
                options.get('headers', []),
                options.get('proxy'),
                options.get('retries', 5),
                options.get('connect_timeout', 15),
                options.get('read_timeout', 60),
                options.get('sha256'),
                quiet=True
            )
            
            # Patch the downloader to report status
            original_draw = dl._draw
            original_progress = [0, 0]
            
            def patched_draw():
                original_draw()
                if dl.progress_total:
                    progress = dl.progress_downloaded / dl.progress_total
                    speed = (dl.progress_downloaded - original_progress[0]) / max(time.time() - original_progress[1], 0.001)
                    eta = (dl.progress_total - dl.progress_downloaded) / max(speed, 1)
                    
                    reporter.report({
                        'type': 'http',
                        'progress': progress,
                        'downloaded': dl.progress_downloaded,
                        'total': dl.progress_total,
                        'speed': speed,
                        'eta': eta,
                        'status': 'downloading'
                    })
                    original_progress[0] = dl.progress_downloaded
                    original_progress[1] = time.time()
            
            dl._draw = patched_draw
            original_progress[1] = time.time()
            
            reporter.report({
                'type': 'http',
                'status': 'initializing',
                'progress': 0
            })
            
            await dl._init_session()
            await dl._probe()
            
            reporter.report({
                'type': 'http',
                'status': 'downloading',
                'progress': 0,
                'total': dl.total_size,
                'accept_ranges': dl.accept_ranges
            })
            
            await dl.download()
            
            reporter.report({
                'type': 'http',
                'status': 'completed',
                'progress': 1.0,
                'downloaded': dl.progress_downloaded,
                'total': dl.progress_total
            })
            
    except Exception as e:
        reporter.report({
            'type': 'error',
            'status': 'error',
            'message': str(e)
        })
        raise

async def download_torrent_with_status(dl, reporter):
    """Download torrent with status reporting"""
    import libtorrent as lt
    import aiohttp
    
    ses = lt.session()
    
    try:
        ses.listen_on(6881, 6891)
    except:
        try:
            ses.apply_settings({"listen_interfaces": "0.0.0.0:6881"})
        except:
            pass
    
    ses.start_dht()
    
    if dl.dl_limit:
        ses.set_download_rate_limit(dl.dl_limit)
    if dl.ul_limit:
        ses.set_upload_rate_limit(dl.ul_limit)
    
    params = {
        "save_path": str(dl.out if dl.out.is_dir() else dl.out.parent),
        "storage_mode": lt.storage_mode_t.storage_mode_sparse \
            if hasattr(lt, "storage_mode_t") else 0,
    }
    
    if dl.src.startswith("magnet:"):
        h = lt.add_magnet_uri(ses, dl.src, params)
    else:
        if dl.src.startswith("http"):
            async with aiohttp.ClientSession() as s:
                async with s.get(dl.src) as r:
                    data = await r.read()
            info = lt.torrent_info(lt.bdecode(data))
        else:
            info = lt.torrent_info(dl.src)
        params["ti"] = info
        h = ses.add_torrent(params)
    
    if dl.seq:
        h.set_sequential_download(True)
    
    reporter.report({
        'type': 'torrent',
        'status': 'getting_metadata',
        'progress': 0
    })
    
    while not h.has_metadata():
        await asyncio.sleep(0.5)
        s = h.status()
        reporter.report({
            'type': 'torrent',
            'status': 'getting_metadata',
            'progress': 0,
            'peers': s.num_peers,
            'seeds': s.num_seeds
        })
    
    last_update = time.time()
    while True:
        s = h.status()
        now = time.time()
        
        reporter.report({
            'type': 'torrent',
            'status': 'downloading' if not s.is_seeding else 'seeding',
            'progress': s.progress,
            'downloaded': s.total_download,
            'total': s.total_wanted,
            'download_rate': s.download_rate,
            'upload_rate': s.upload_rate,
            'peers': s.num_peers,
            'seeds': s.num_seeds,
            'eta': s.progress_parts_per_mil / 10000 if s.progress_parts_per_mil > 0 else 0
        })
        
        if s.is_seeding:
            break
        
        await asyncio.sleep(0.5)
    
    reporter.report({
        'type': 'torrent',
        'status': 'completed',
        'progress': 1.0
    })

def parse_bytes_optional(s: str):
    """Parse bytes with None handling"""
    if not s:
        return None
    return parse_bytes_clidm(s)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--download-id', required=True)
    parser.add_argument('--concurrency', type=int)
    parser.add_argument('--chunk-size')
    parser.add_argument('--limit')
    parser.add_argument('--bt-upload-limit')
    parser.add_argument('--bt-sequential', action='store_true')
    parser.add_argument('--connect-timeout', type=int)
    parser.add_argument('--read-timeout', type=int)
    parser.add_argument('--retries', type=int)
    parser.add_argument('--sha256')
    
    args = parser.parse_args()
    
    options = {
        'concurrency': args.concurrency,
        'chunk_size': args.chunk_size,
        'limit': parse_bytes_optional(args.limit) if args.limit else None,
        'bt_upload_limit': parse_bytes_optional(args.bt_upload_limit) if args.bt_upload_limit else None,
        'bt_sequential': args.bt_sequential,
        'connect_timeout': args.connect_timeout,
        'read_timeout': args.read_timeout,
        'retries': args.retries,
        'sha256': args.sha256,
        'headers': [],
    }
    
    asyncio.run(download_with_status(args.source, args.output, args.download_id, options))

if __name__ == '__main__':
    main()

