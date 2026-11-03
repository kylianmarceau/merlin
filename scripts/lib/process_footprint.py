#!/usr/bin/env python3
"""Read macOS process memory ledgers, without reading process memory contents.

The ABI is rusage_info_v2 / RUSAGE_INFO_V2 in the macOS SDK's sys/resource.h
and libproc.h. Physical footprint includes charged memory beyond live heap.
"""
import ctypes
import json
import os
import sys


class Usage(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_uint8 * 16)] + [
        (name, ctypes.c_uint64) for name in (
            'user_time', 'system_time', 'pkg_idle_wkups', 'interrupt_wkups',
            'pageins', 'wired_size', 'resident_size', 'phys_footprint',
            'proc_start_abstime', 'proc_exit_abstime', 'child_user_time',
            'child_system_time', 'child_pkg_idle_wkups', 'child_interrupt_wkups',
            'child_pageins', 'child_elapsed_abstime', 'diskio_bytesread',
            'diskio_byteswritten')]


def main():
    if sys.platform != 'darwin':
        raise SystemExit('Physical-footprint measurement requires macOS')
    assert ctypes.sizeof(Usage) == 160
    lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    lib.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    lib.proc_pid_rusage.restype = ctypes.c_int
    processes = []
    for pid in map(int, sys.argv[1:]):
        info = Usage()
        if lib.proc_pid_rusage(pid, 2, ctypes.byref(info)) != 0:
            error = ctypes.get_errno()
            raise OSError(error, os.strerror(error), str(pid))
        if not info.phys_footprint:
            raise RuntimeError(f'Empty physical footprint for live PID {pid}')
        processes.append({'pid': pid, 'physical_footprint_bytes': info.phys_footprint,
                          'resident_bytes': info.resident_size})
    if not processes:
        raise SystemExit('Pass one or more live process IDs')
    print(json.dumps({'processes': processes,
                      'total_bytes': sum(p['physical_footprint_bytes'] for p in processes)}))


if __name__ == '__main__':
    main()
