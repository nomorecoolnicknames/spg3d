#!/bin/bash
O=/mnt/ramdisk/spg-shots; mkdir -p $O; : > $O/batch4.log
node qa/shot.mjs "?screen=race&track=neon&auto=1&q=low&maxdt=0.5&ts=3" "$O/neon3" 15000,40000 1280 720 > "$O/neon3.log" 2>&1; echo "DONE neon3" >> $O/batch4.log
node qa/shot.mjs "?screen=garage&car=lancia&q=low&pose=0.7" "$O/pose2-lancia" 1500 1280 720 > "$O/pose2-lancia.log" 2>&1; echo "DONE lancia" >> $O/batch4.log
node qa/shot.mjs "?screen=race&track=aurora&auto=1&q=low&maxdt=0.5&ts=3" "$O/aurora3" 30000 1280 720 > "$O/aurora3.log" 2>&1; echo "DONE aurora3" >> $O/batch4.log
node qa/shot.mjs "?screen=menu&q=low" "$O/menu2" 2500 1280 720 > "$O/menu2.log" 2>&1; echo "DONE menu2" >> $O/batch4.log
echo ALL_DONE >> $O/batch4.log
