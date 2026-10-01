#!/usr/bin/env bash
# ============================================================
# HR DATA PIPELINE (ETL)
# ============================================================
# Run this script before terraform apply. It takes the two raw
# HR exports you name on the command line, validates them, and
# stages clean copies in 01-identity/data/ for Terraform.
#
# Usage:
#   ./scripts/00-hr-data-etl.sh <employees.csv> <teams.csv>
#
# Example:
#   ./scripts/00-hr-data-etl.sh incoming/employee_db.csv incoming/teams_db.csv
#
# What it checks (any failure stops the script and writes nothing):
# - exactly two files are given, both exist and are readable
# - headers match the expected columns (case, spaces and
#   underscores are normalised, so "First name" = "first_name")
#     employees: first_name,last_name,team
#     teams:     team,applications,role_requirements
# - every employee row has exactly 3 non-blank fields
# - names contain only letters and hyphens (they become the
#   firstname.lastname username)
# - no two employees produce the same firstname.lastname key
# - every employee's team exists in the teams file
# - team names are unique and non-blank
# - the employee file has at least MIN_EMPLOYEES rows
#   (environment variable, default 1; Terraform has its own
#   min_expected_employees guard as well)
#
# What it changes:
# - removes the UTF-8 BOM and Windows line endings
# - rewrites the header row to the exact names Terraform expects
# - writes data/employees.csv and data/teams.csv through temp
#   files and only moves them into place after BOTH files pass
#
# What it does NOT do:
# - it never deletes your source files. The raw exports may be
#   the only copy, so deleting them is left to you (the script
#   prints a reminder). incoming/ and data/ are gitignored.
#
# Why this matters: Terraform DELETES every Entra account whose
# row disappears from data/employees.csv. The checks above stop a
# wrong or truncated file before it reaches Terraform, and the
# script prints how many rows were added or removed compared with
# the current data/employees.csv so you can sanity-check the plan.
# ============================================================

set -euo pipefail

# HR data is personal information: files we create are owner-only
umask 077

# Byte-wise text handling: the BOM is matched as raw bytes and
# [A-Za-z] means ASCII letters only, the same on Linux, macOS
# and Git Bash
export LC_ALL=C

usage() {
  echo "Usage: $0 <employees.csv> <teams.csv>" >&2
  echo "Example: $0 incoming/employee_db.csv incoming/teams_db.csv" >&2
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

# Absolute path of a file, resolved from the caller's directory
abspath() {
  local dir
  dir=$(cd "$(dirname -- "$1")" && pwd) || return 1
  printf '%s/%s\n' "$dir" "$(basename -- "$1")"
}

if [ "$#" -ne 2 ]; then
  usage
  exit 2
fi

for f in "$1" "$2"; do
  [ -f "$f" ] || fail "File not found: $f"
  [ -r "$f" ] || fail "File not readable: $f"
done

EMP_SRC=$(abspath "$1")
TEAM_SRC=$(abspath "$2")
[ "$EMP_SRC" != "$TEAM_SRC" ] || fail "The employee and team arguments are the same file."

MIN_EMPLOYEES=${MIN_EMPLOYEES:-1}
case "$MIN_EMPLOYEES" in
  '' | *[!0-9]*) fail "MIN_EMPLOYEES must be a whole number, got: $MIN_EMPLOYEES" ;;
esac

# Work from 01-identity/ so data/ is always the folder Terraform
# reads (terraform/../data), wherever the script is called from
SCRIPT_DIR=$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR/.."

mkdir -p data
EMP_OUT=data/employees.csv
TEAM_OUT=data/teams.csv

# Temp files live in data/ so the final mv is a same-folder rename
EMP_TMP=$(mktemp data/.employees.XXXXXX)
TEAM_TMP=$(mktemp data/.teams.XXXXXX)
cleanup() { rm -f "$EMP_TMP" "$TEAM_TMP"; }
trap cleanup EXIT

echo "Starting HR Data Pipeline..."
echo "  employees: $EMP_SRC"
echo "  teams:     $TEAM_SRC"

# ------------------------------------------------------------
# [1] TEAMS: normalise, validate, stage
# ------------------------------------------------------------
# Only the first column (team) is checked; the other columns may
# contain quoted, comma-separated app lists and are copied as-is.
awk -v out="$TEAM_TMP" '
  function norm(s) { s = tolower(s); gsub(/^[ \t]+|[ \t]+$/, "", s); gsub(/[ \t]+/, "_", s); return s }
  function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
  {
    sub(/\r$/, "")
    if (NR == 1) {
      sub(/^\357\273\277/, "")
      n = split($0, h, ",")
      got = ""
      for (i = 1; i <= n; i++) got = got (i > 1 ? "," : "") norm(h[i])
      if (got != "team,applications,role_requirements") {
        printf "ERROR: teams header is \"%s\", expected team,applications,role_requirements\n", got > "/dev/stderr"
        bad = 1; exit 1
      }
      print "team,applications,role_requirements" > out
      next
    }
    if ($0 ~ /^[ \t,]*$/) next
    if (substr($0, 1, 1) == "\"") {
      printf "ERROR: teams line %d: team name must not be quoted\n", NR > "/dev/stderr"; bad = 1; next
    }
    split($0, f, ",")
    team = trim(f[1])
    if (team !~ /^[A-Za-z0-9][A-Za-z0-9 -]*$/) {
      printf "ERROR: teams line %d: invalid team name \"%s\"\n", NR, team > "/dev/stderr"; bad = 1; next
    }
    if (team in seen) {
      printf "ERROR: teams line %d: duplicate team \"%s\"\n", NR, team > "/dev/stderr"; bad = 1; next
    }
    seen[team] = 1; count++
    print $0 > out
  }
  END {
    if (bad) exit 1
    if (count == 0) { print "ERROR: teams file has no team rows" > "/dev/stderr"; exit 1 }
  }
' "$TEAM_SRC" || fail "Teams file failed validation. Nothing was written."

# ------------------------------------------------------------
# [2] EMPLOYEES: normalise, validate against teams, stage
# ------------------------------------------------------------
awk -v out="$EMP_TMP" -v teamsfile="$TEAM_TMP" -v min="$MIN_EMPLOYEES" '
  function norm(s) { s = tolower(s); gsub(/^[ \t]+|[ \t]+$/, "", s); gsub(/[ \t]+/, "_", s); return s }
  function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
  BEGIN {
    # Load the validated team names
    while ((getline line < teamsfile) > 0) {
      if (++ln == 1) continue
      split(line, f, ","); teams[trim(f[1])] = 1
    }
    close(teamsfile)
  }
  {
    sub(/\r$/, "")
    if (NR == 1) {
      sub(/^\357\273\277/, "")
      n = split($0, h, ",")
      got = ""
      for (i = 1; i <= n; i++) got = got (i > 1 ? "," : "") norm(h[i])
      if (got != "first_name,last_name,team") {
        printf "ERROR: employees header is \"%s\", expected first_name,last_name,team\n", got > "/dev/stderr"
        bad = 1; exit 1
      }
      print "first_name,last_name,team" > out
      next
    }
    if ($0 ~ /^[ \t,]*$/) {
      if ($0 ~ /,/) { printf "ERROR: employees line %d: blank row\n", NR > "/dev/stderr"; bad = 1 }
      next
    }
    if (index($0, "\"") > 0) {
      printf "ERROR: employees line %d: quotes are not allowed\n", NR > "/dev/stderr"; bad = 1; next
    }
    n = split($0, f, ",")
    if (n != 3) {
      printf "ERROR: employees line %d: expected 3 fields, found %d\n", NR, n > "/dev/stderr"; bad = 1; next
    }
    first = trim(f[1]); last = trim(f[2]); team = trim(f[3])
    if (first == "" || last == "" || team == "") {
      printf "ERROR: employees line %d: blank first name, last name or team\n", NR > "/dev/stderr"; bad = 1; next
    }
    if (first !~ /^[A-Za-z][A-Za-z-]*$/ || last !~ /^[A-Za-z][A-Za-z-]*$/) {
      printf "ERROR: employees line %d: names may contain only letters and hyphens\n", NR > "/dev/stderr"; bad = 1; next
    }
    if (!(team in teams)) {
      printf "ERROR: employees line %d: team \"%s\" is not in the teams file\n", NR, team > "/dev/stderr"; bad = 1; next
    }
    key = tolower(first) "." tolower(last)
    if (key in seen) {
      printf "ERROR: employees line %d: duplicate user %s (also on line %d)\n", NR, key, seen[key] > "/dev/stderr"; bad = 1; next
    }
    seen[key] = NR; count++
    print first "," last "," team > out
  }
  END {
    if (bad) exit 1
    if (count < min) {
      printf "ERROR: employees file has %d rows, fewer than MIN_EMPLOYEES (%d)\n", count, min > "/dev/stderr"; exit 1
    }
    printf "Validated %d employees.\n", count
  }
' "$EMP_SRC" || fail "Employee file failed validation. Nothing was written."

# ------------------------------------------------------------
# [3] DIFF SUMMARY: rows added / removed vs the current roster
# ------------------------------------------------------------
# Counts only, so no names are printed. Removed rows become
# account DELETIONS on the next terraform apply.
if [ -f "$EMP_OUT" ]; then
  keys() { awk -F, 'NR > 1 && NF == 3 { print tolower($1) "." tolower($2) }' "$1" | sort -u; }
  ADDED=$(comm -13 <(keys "$EMP_OUT") <(keys "$EMP_TMP") | wc -l | tr -d ' ')
  REMOVED=$(comm -23 <(keys "$EMP_OUT") <(keys "$EMP_TMP") | wc -l | tr -d ' ')
  echo "Compared with current $EMP_OUT: $ADDED added, $REMOVED removed."
  if [ "$REMOVED" -gt 0 ]; then
    echo "WARNING: $REMOVED removed row(s) will DELETE those Entra accounts on terraform apply."
  fi
fi

# ------------------------------------------------------------
# [4] LOAD: move both files into place only after both passed
# ------------------------------------------------------------
mv -f "$TEAM_TMP" "$TEAM_OUT"
mv -f "$EMP_TMP" "$EMP_OUT"
trap - EXIT

echo "Staged $EMP_OUT and $TEAM_OUT (owner-only permissions)."
echo "Source files were left in place. Delete them once you no longer need them:"
echo "  $EMP_SRC"
echo "  $TEAM_SRC"
echo "Next: cd terraform && terraform plan (read every delete before applying)."
