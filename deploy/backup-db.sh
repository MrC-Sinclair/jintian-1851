#!/bin/sh
# 金田：1851 — 线上 PostgreSQL 每日备份
#
# 为什么需要：CVM 只有一块 50G 系统盘，pgdata 是普通本地卷，
# 没有任何云硬盘快照策略 —— 机器挂掉 / 误删卷 / 容器被 down -v，存档就永久没了。
#
# 用法（服务器上）：
#   /root/jintian/deploy/backup-db.sh              # 跑一次备份
#   /root/jintian/deploy/backup-db.sh --list       # 看现有备份与保留情况
#   /root/jintian/deploy/backup-db.sh --restore 2026-10-11-031700   # 从指定备份恢复
#
# 定时（cron，每日 03:17）：
#   17 3 * * * /root/jintian/deploy/backup-db.sh >> /root/jintian/backups/backup.log 2>&1
#
# ⚠️ 恢复会覆盖线上数据。--restore 前脚本会先自动做一次「恢复前快照」并要求二次确认，
#    非交互环境（cron）下不会执行恢复。

set -eu

CONTAINER="${CONTAINER:-jintian-db}"
DB_USER="${DB_USER:-jintian}"
DB_NAME="${DB_NAME:-jintian}"
BACKUP_DIR="${BACKUP_DIR:-/root/jintian/backups}"
# 保留份数：每日一份 × 14 天。2G 内存 / 44G 磁盘的机器上，
# 本项目库当前只有几百行，单份 gzip 后是 KB 级，14 份的占用可以忽略。
KEEP="${KEEP:-14}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# 备份走容器内的本地 socket：postgres 镜像对容器内回环连接默认 trust，
# 因此不需要把密码写进脚本或命令行（命令行带密码会进 ps 与 shell 历史）。
do_backup() {
  if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
    log "跳过：容器 $CONTAINER 未运行"
    return 1
  fi

  mkdir -p "$BACKUP_DIR"
  stamp=$(date '+%Y-%m-%d-%H%M%S')
  out="$BACKUP_DIR/$DB_NAME-$stamp.sql.gz"

  docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "$out"

  # 校验产物非空：pg_dump 失败时管道仍可能留下 0 字节的 gzip 头，
  # 只看退出码不足以发现「备份成功但是空库」
  size=$(wc -c < "$out")
  if [ "$size" -lt 100 ]; then
    log "异常：备份文件仅 $size 字节，疑似空库或 dump 失败，保留文件但不计入轮转"
    return 1
  fi

  log "已备份 $out（${size} 字节）"

  # 轮转：按文件名排序删除最旧的（文件名以时间戳开头，字典序即时间序）
  old=$(ls -1 "$BACKUP_DIR"/"$DB_NAME"-*.sql.gz 2>/dev/null | sort | head -n -"$KEEP" || true)
  if [ -n "$old" ]; then
    # shellcheck disable=SC2086
    rm -f $old
    log "轮转删除 $(echo "$old" | wc -l) 份旧备份，保留最近 $KEEP 份"
  fi
}

do_list() {
  ls -1sh "$BACKUP_DIR"/"$DB_NAME"-*.sql.gz 2>/dev/null || echo "（暂无备份）"
}

do_restore() {
  tag="$1"
  src="$BACKUP_DIR/$DB_NAME-$tag.sql.gz"
  if [ ! -f "$src" ]; then
    log "找不到备份：$src"
    return 1
  fi

  # 恢复前自动留一份当前数据，出问题还能退回去
  pre="$BACKUP_DIR/pre-restore-$(date '+%Y-%m-%d-%H%M%S').sql.gz"
  docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "$pre"
  log "已留存恢复前快照：$pre"

  # 交互确认：cron 里 stdin 非 tty，会直接退出，不会误覆盖线上数据
  printf '即将用 %s 覆盖线上库 %s，输入 yes 确认：' "$src" "$DB_NAME"
  if [ ! -t 0 ]; then
    echo "非交互环境，已取消"
    return 1
  fi
  read -r ans
  [ "$ans" = "yes" ] || { echo "已取消"; return 1; }

  # 先清空目标库再导入：pg_restore/psql 是叠加式的，不清会导致旧数据残留
  docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
  gunzip -c "$src" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1
  log "恢复完成（来自 $src）"
}

case "${1:-backup}" in
  --list | list) do_list ;;
  --restore) do_restore "${2:-}" ;;
  backup | *) do_backup ;;
esac
