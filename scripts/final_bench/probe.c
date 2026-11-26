// probe: per-process resource ledgers for one browser instance, as JSON.
//   probe <bundle-path> <root-pid> [<root-pid>...]
// Covers the process tree under each root plus any live process whose
// executable sits inside the bundle (helpers launched through launchd/XPC).
// Reads proc_pid_rusage(RUSAGE_INFO_V6): phys_footprint, CPU time,
// wakeups, CPU energy (nJ) and disk I/O. Never reads process memory.
#include <libproc.h>
#include <mach/mach_time.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/sysctl.h>

static int kind_of(pid_t pid, char *out, size_t n) {
  int mib[3] = {CTL_KERN, KERN_PROCARGS2, pid};
  size_t size = 0;
  snprintf(out, n, "browser");
  if (sysctl(mib, 3, NULL, &size, NULL, 0) != 0 || size == 0) return 0;
  char *buf = malloc(size);
  if (sysctl(mib, 3, buf, &size, NULL, 0) != 0) { free(buf); return 0; }
  int argc; memcpy(&argc, buf, sizeof argc);
  char *p = buf + sizeof argc, *end = buf + size;
  p += strlen(p) + 1;                       // exec path
  while (p < end && *p == 0) p++;
  int plugin = strstr(buf + sizeof argc, "plugin-container") != NULL, gpu = strstr(buf + sizeof argc, "GPU Helper") != NULL;
  if (gpu) snprintf(out, n, "gpu-process");
  else if (plugin) snprintf(out, n, "utility");
  for (int i = 0; i < argc && p < end; i++) {
    if (!strncmp(p, "--type=", 7)) { snprintf(out, n, "%s", p + 7); break; }
    if (plugin && !strcmp(p, "-isForBrowser")) { snprintf(out, n, "renderer"); break; }
    p += strlen(p) + 1;
  }
  free(buf);
  return 1;
}

int main(int argc, char **argv) {
  if (argc < 3) { fprintf(stderr, "usage: probe <bundle> <pid>...\n"); return 2; }
  const char *bundle = argv[1];
  int cap = proc_listallpids(NULL, 0) + 256;
  pid_t *pids = calloc(cap, sizeof(pid_t));
  int n = proc_listallpids(pids, cap * sizeof(pid_t));
  pid_t *ppid = calloc(n, sizeof(pid_t));
  for (int i = 0; i < n; i++) {
    struct proc_bsdshortinfo si;
    ppid[i] = proc_pidinfo(pids[i], PROC_PIDT_SHORTBSDINFO, 0, &si, sizeof si) == sizeof si ? si.pbsi_ppid : -1;
  }
  char *in = calloc(n, 1);
  for (int a = 2; a < argc; a++) { pid_t r = atoi(argv[a]); for (int i = 0; i < n; i++) if (pids[i] == r) in[i] = 1; }
  for (int changed = 1; changed;) {
    changed = 0;
    for (int i = 0; i < n; i++) if (!in[i]) for (int j = 0; j < n; j++) if (in[j] && pids[j] == ppid[i]) { in[i] = 1; changed = 1; break; }
  }
  size_t bl = strlen(bundle);
  for (int i = 0; i < n; i++) if (!in[i] && bl > 4) {
    char path[PROC_PIDPATHINFO_MAXSIZE];
    if (proc_pidpath(pids[i], path, sizeof path) > 0 && !strncmp(path, bundle, bl)) in[i] = 1;
  }
  mach_timebase_info_data_t tb; mach_timebase_info(&tb);
  printf("{\"t\":%.3f,\"processes\":[", (double)clock_gettime_nsec_np(CLOCK_REALTIME) / 1e6);
  int first = 1;
  for (int i = 0; i < n; i++) if (in[i]) {
    struct rusage_info_v6 ri;
    if (proc_pid_rusage(pids[i], RUSAGE_INFO_V6, (rusage_info_t *)&ri) != 0) continue;
    char kind[64]; kind_of(pids[i], kind, sizeof kind);
    char name[256] = ""; proc_name(pids[i], name, sizeof name);
    for (char *c = name; *c; c++) if (*c == '"' || *c == '\\') *c = '_';
    double cpu_ns = (double)(ri.ri_user_time + ri.ri_system_time) * tb.numer / tb.denom;
    printf("%s{\"pid\":%d,\"ppid\":%d,\"name\":\"%s\",\"kind\":\"%s\",\"footprint\":%llu,\"resident\":%llu,\"cpu_ns\":%.0f,"
           "\"idle_wakeups\":%llu,\"int_wakeups\":%llu,\"energy_nj\":%llu,\"disk_read\":%llu,\"disk_written\":%llu}",
           first ? "" : ",", pids[i], ppid[i], name, kind, ri.ri_phys_footprint, ri.ri_resident_size, cpu_ns,
           ri.ri_pkg_idle_wkups, ri.ri_interrupt_wkups, ri.ri_energy_nj, ri.ri_diskio_bytesread, ri.ri_diskio_byteswritten);
    first = 0;
  }
  printf("]}\n");
  return 0;
}
