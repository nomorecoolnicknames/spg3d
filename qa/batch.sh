#!/bin/bash
# sequential low-quality shots for iteration; output to /mnt/ramdisk/spg-shots
O=/mnt/ramdisk/spg-shots; mkdir -p $O
run() { node qa/shot.mjs "$1" "$O/$2" "$3" 1280 720 > "$O/$2.log" 2>&1; echo "DONE $2 $?" >> "$O/batch.log"; }
: > $O/batch.log
run "?screen=race&track=neon&auto=1&q=low&maxdt=0.5" neon 6000,20000,45000
run "?screen=race&track=canyon&auto=1&q=low&maxdt=0.5" canyon 20000
run "?screen=race&track=aurora&auto=1&q=low&maxdt=0.5" aurora 20000
run "?screen=boss&auto=1&q=low&maxdt=0.5" boss 2000,8000,20000
run "?screen=garage&q=low" garage 4000
echo "ALL_DONE" >> $O/batch.log
