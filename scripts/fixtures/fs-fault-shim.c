/*
 * DesignForge 审计用文件系统故障注入 shim（仅测试工装，不进入产品代码）。
 *
 * 通过 LD_PRELOAD 注入 daemon 子进程，按环境变量对匹配路径注入确定性故障：
 *   DF_FAULT_OP           open | write | fsync | rename（缺省 disabled）
 *   DF_FAULT_PATH         路径子串（如 "/pages/"、"/manifest.json"）
 *   DF_FAULT_ERRNO        注入的 errno（缺省 28 = ENOSPC；5=EIO，13=EACCES）
 *   DF_FAULT_AFTER_BYTES  write：同一 fd 累计写入达到该字节数后失败（缺省 0 = 首次写）
 *   DF_FAULT_SKIP         允许前 N 次匹配成功（缺省 0）
 *
 * 构建：gcc -shared -fPIC -O2 -o fs-fault-shim.so fs-fault-shim.c -ldl -lpthread
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAX_FDS 8192

static int (*real_open)(const char *, int, ...);
static int (*real_open64)(const char *, int, ...);
static int (*real_openat)(int, const char *, int, ...);
static int (*real_openat64)(int, const char *, int, ...);
static ssize_t (*real_write)(int, const void *, size_t);
static int (*real_fsync)(int);
static int (*real_rename)(const char *, const char *);
static int (*real_renameat)(int, const char *, int, const char *);
static int (*real_renameat2)(int, const char *, int, const char *, unsigned int);
static int (*real_close)(int);

static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static char *fd_paths[MAX_FDS];
static size_t fd_written[MAX_FDS];

static const char *fault_op;
static const char *fault_path;
static int fault_errno = ENOSPC;
static long fault_after = 0;
static long fault_skip = 0;
static long fault_matches = 0;

__attribute__((constructor)) static void init_shim(void) {
  real_open = dlsym(RTLD_NEXT, "open");
  real_open64 = dlsym(RTLD_NEXT, "open64");
  real_openat = dlsym(RTLD_NEXT, "openat");
  real_openat64 = dlsym(RTLD_NEXT, "openat64");
  real_write = dlsym(RTLD_NEXT, "write");
  real_fsync = dlsym(RTLD_NEXT, "fsync");
  real_rename = dlsym(RTLD_NEXT, "rename");
  real_renameat = dlsym(RTLD_NEXT, "renameat");
  real_renameat2 = dlsym(RTLD_NEXT, "renameat2");
  real_close = dlsym(RTLD_NEXT, "close");

  fault_op = getenv("DF_FAULT_OP");
  fault_path = getenv("DF_FAULT_PATH");
  const char *errno_raw = getenv("DF_FAULT_ERRNO");
  if (errno_raw != NULL) fault_errno = atoi(errno_raw);
  const char *after_raw = getenv("DF_FAULT_AFTER_BYTES");
  if (after_raw != NULL) fault_after = atol(after_raw);
  const char *skip_raw = getenv("DF_FAULT_SKIP");
  if (skip_raw != NULL) fault_skip = atol(skip_raw);
}

static int op_is(const char *name) {
  return fault_op != NULL && strcmp(fault_op, name) == 0;
}

static int path_matches(const char *path) {
  if (fault_path == NULL || path == NULL) return 0;
  return strstr(path, fault_path) != NULL;
}

/* 返回 1 表示本次调用应注入故障。 */
static int should_fail(void) {
  pthread_mutex_lock(&lock);
  long current = fault_matches++;
  pthread_mutex_unlock(&lock);
  return current >= fault_skip;
}

static void remember_fd(int fd, const char *path) {
  if (fd < 0 || fd >= MAX_FDS) return;
  char *copy = strdup(path);
  if (copy == NULL) return;
  pthread_mutex_lock(&lock);
  free(fd_paths[fd]);
  fd_paths[fd] = copy;
  fd_written[fd] = 0;
  pthread_mutex_unlock(&lock);
}

static void forget_fd(int fd) {
  if (fd < 0 || fd >= MAX_FDS) return;
  pthread_mutex_lock(&lock);
  free(fd_paths[fd]);
  fd_paths[fd] = NULL;
  fd_written[fd] = 0;
  pthread_mutex_unlock(&lock);
}

static int fault_open(const char *path, int flags, mode_t mode, int (*impl)(const char *, int, ...)) {
  if (op_is("open") && (flags & O_CREAT) != 0 && path_matches(path)) {
    if (should_fail()) {
      errno = fault_errno;
      return -1;
    }
  }
  int fd = impl(path, flags, mode);
  if (fd >= 0) remember_fd(fd, path);
  return fd;
}

int open(const char *path, int flags, ...) {
  mode_t mode = 0;
  if ((flags & O_CREAT) != 0) {
    va_list args;
    va_start(args, flags);
    mode = (mode_t)va_arg(args, int);
    va_end(args);
  }
  return fault_open(path, flags, mode, real_open);
}

int open64(const char *path, int flags, ...) {
  mode_t mode = 0;
  if ((flags & O_CREAT) != 0) {
    va_list args;
    va_start(args, flags);
    mode = (mode_t)va_arg(args, int);
    va_end(args);
  }
  return fault_open(path, flags, mode, real_open64);
}

int openat(int dirfd, const char *path, int flags, ...) {
  mode_t mode = 0;
  if ((flags & O_CREAT) != 0) {
    va_list args;
    va_start(args, flags);
    mode = (mode_t)va_arg(args, int);
    va_end(args);
  }
  if (op_is("open") && (flags & O_CREAT) != 0 && path_matches(path)) {
    if (should_fail()) {
      errno = fault_errno;
      return -1;
    }
  }
  int fd = real_openat(dirfd, path, flags, mode);
  if (fd >= 0) remember_fd(fd, path);
  return fd;
}

int openat64(int dirfd, const char *path, int flags, ...) {
  mode_t mode = 0;
  if ((flags & O_CREAT) != 0) {
    va_list args;
    va_start(args, flags);
    mode = (mode_t)va_arg(args, int);
    va_end(args);
  }
  if (op_is("open") && (flags & O_CREAT) != 0 && path_matches(path)) {
    if (should_fail()) {
      errno = fault_errno;
      return -1;
    }
  }
  int fd = real_openat64(dirfd, path, flags, mode);
  if (fd >= 0) remember_fd(fd, path);
  return fd;
}

ssize_t write(int fd, const void *buf, size_t count) {
  if (op_is("write") && fd >= 0 && fd < MAX_FDS) {
    pthread_mutex_lock(&lock);
    char *path = fd_paths[fd];
    size_t written = fd_written[fd];
    int matched = path != NULL && path_matches(path);
    pthread_mutex_unlock(&lock);
    if (matched) {
      if (should_fail()) {
        errno = fault_errno;
        return -1;
      }
      if (fault_after > 0 && written + count > (size_t)fault_after) {
        pthread_mutex_lock(&lock);
        fd_written[fd] += (size_t)fault_after - written;
        pthread_mutex_unlock(&lock);
        errno = fault_errno;
        return -1;
      }
      ssize_t result = real_write(fd, buf, count);
      if (result > 0) {
        pthread_mutex_lock(&lock);
        fd_written[fd] += (size_t)result;
        pthread_mutex_unlock(&lock);
      }
      return result;
    }
  }
  return real_write(fd, buf, count);
}

int fsync(int fd) {
  if (op_is("fsync") && fd >= 0 && fd < MAX_FDS) {
    pthread_mutex_lock(&lock);
    char *path = fd_paths[fd];
    int matched = path != NULL && path_matches(path);
    pthread_mutex_unlock(&lock);
    if (matched && should_fail()) {
      errno = fault_errno;
      return -1;
    }
  }
  return real_fsync(fd);
}

int rename(const char *oldpath, const char *newpath) {
  if (op_is("rename") && (path_matches(oldpath) || path_matches(newpath)) && should_fail()) {
    errno = fault_errno;
    return -1;
  }
  return real_rename(oldpath, newpath);
}

int renameat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath) {
  if (op_is("rename") && (path_matches(oldpath) || path_matches(newpath)) && should_fail()) {
    errno = fault_errno;
    return -1;
  }
  return real_renameat(olddirfd, oldpath, newdirfd, newpath);
}

int renameat2(int olddirfd, const char *oldpath, int newdirfd, const char *newpath,
              unsigned int flags) {
  if (op_is("rename") && (path_matches(oldpath) || path_matches(newpath)) && should_fail()) {
    errno = fault_errno;
    return -1;
  }
  if (real_renameat2 == NULL) {
    errno = ENOSYS;
    return -1;
  }
  return real_renameat2(olddirfd, oldpath, newdirfd, newpath, flags);
}

int close(int fd) {
  forget_fd(fd);
  return real_close(fd);
}
