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
#
# 每次运行都会把结果落到 $STATUS_FILE（默认 backups/health-status.json），
# 供 GET /api/health 判定备份新鲜度——cron 的退出码没人读，只有变成可探活的状态才不会静默失效。

set -eu

CONTAINER="${CONTAINER:-jintian-db}"
DB_USER="${DB_USER:-jintian}"
DB_NAME="${DB_NAME:-jintian}"
BACKUP_DIR="${BACKUP_DIR:-/root/jintian/backups}"
STATUS_FILE="${STATUS_FILE:-$BACKUP_DIR/health-status.json}"
# 保留份数：每日一份 × 14 天。2G 内存 / 44G 磁盘的机器上，
# 本项目库当前只有几百行，单份 gzip 后是 KB 级，14 份的占用可以忽略。
KEEP="${KEEP:-14}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# 只有备份路径需要落状态；--list / --restore 成功与否都不该改动"备份是否新鲜"的结论
ARM_STATUS=0
LAST_ERROR=""
# 本次成功的产物信息（供 write_status 使用）
OK_FILE=""
OK_BYTES=""

# JSON 字符串值消毒：错误信息里可能带引号/反斜杠/换行，不处理会写出非法 JSON
json_str() {
  printf '%s' "$1" | tr '\n\r' '  ' | tr -d '"\\' | cut -c1-200
}

# 从既有状态文件里保住 lastSuccessAt：失败不能把"上次成功的时间"抹掉，
# 否则连续失败会让 ageHours 从"很久没成功"退化成"从未成功"，排查方向完全不同
prev_last_success() {
  [ -f "$STATUS_FILE" ] || return 0
  sed -n 's/.*"lastSuccessAt":"\([^"]*\)".*/\1/p' "$STATUS_FILE" | head -n 1
}

write_status() {
  # $1: ok(true|false)  $2: 失败原因（ok=true 时留空）
  ok="$1"
  reason="$2"
  # 必须落 UTC 的 Z 形式：`date +%z` 给的是 +0800（偏移里没冒号），
  # 那种写法 Date.parse 不认（会按读方本地时区解释，同一个字符串在不同机器上算出不同时刻）。
  now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  last_success=$(prev_last_success)
  if [ "$ok" = "true" ]; then
    last_success="$now"
  fi

  mkdir -p "$(dirname "$STATUS_FILE")" 2>/dev/null || return 0

  if [ -n "$last_success" ]; then
    success_field="\"$last_success\""
  else
    success_field="null"
  fi

  # 先写临时文件再 mv：health 每 20s 读一次，不能读到半截 JSON
  tmp="$STATUS_FILE.tmp.$$"
  printf '{"ok":%s,"lastAttemptAt":"%s","lastSuccessAt":%s,"file":"%s","bytes":%s,"error":%s}\n' \
    "$ok" "$now" "$success_field" "$(json_str "${OK_FILE:-}")" "${OK_BYTES:-0}" \
    "$([ -n "$reason" ] && printf '"%s"' "$(json_str "$reason")" || printf 'null')" > "$tmp"
  mv -f "$tmp" "$STATUS_FILE" || log "状态文件写入失败：$STATUS_FILE"
}

on_exit() {
  code=$?
  [ "$ARM_STATUS" = "1" ] || return 0
  if [ "$code" -eq 0 ]; then
    write_status true ""
  else
    write_status false "${LAST_ERROR:-backup-db.sh 以退出码 $code 中断}"
  fi
}
trap on_exit EXIT

fail() {
  LAST_ERROR="$1"
  log "异常：$1"
  return 1
}

# 备份走容器内的本地 socket：postgres 镜像对容器内回环连接默认 trust，
# 因此不需要把密码写进脚本或命令行（命令行带密码会进 ps 与 shell 历史）。
do_backup() {
  if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
    fail "容器 $CONTAINER 未运行，本次没有备份"
  fi

  mkdir -p "$BACKUP_DIR"
  stamp=$(date '+%Y-%m-%d-%H%M%S')
  out="$BACKUP_DIR/$DB_NAME-$stamp.sql.gz"

  # 先落裸 SQL 再单独 gzip：原来写成 `pg_dump | gzip`，管道退出码取的是最后一个命令，
  # pg_dump 失败被 gzip 的成功盖掉，只能靠体积猜出来、报成"字节过小"。
  # 本脚本跑在 sh(dash) 下没有 pipefail 可用，所以拆成两步直接判 pg_dump 的退出码。
  raw="$out.part"
  if ! docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" > "$raw"; then
    rm -f "$raw"
    fail "pg_dump 失败（容器 $CONTAINER / 库 $DB_NAME）"
  fi
  if ! gzip -c "$raw" > "$out"; then
    rm -f "$raw" "$out"
    fail "gzip 失败"
  fi
  rm -f "$raw"

  # 校验产物非空：pg_dump 失败时管道仍可能留下 0 字节的 gzip 头，
  # 只看退出码不足以发现「备份成功但是空库」
  size=$(wc -c < "$out")
  if [ "$size" -lt 100 ]; then
    fail "备份文件仅 $size 字节，疑似空库或 dump 失败，保留文件但不计入轮转"
  fi

  OK_FILE=$(basename "$out")
  OK_BYTES="$size"
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
  backup | *)
    # 只有这条路径参与"备份是否新鲜"的判定
    ARM_STATUS=1
    do_backup
    ;;
esac
