#!/bin/bash
O=/mnt/ramdisk/spg-shots; mkdir -p $O
until grep -q ALL_DONE $O/batch2.log; do sleep 10; done
: > $O/batch3.log
for c in m5cs supra lancia m8 gt40 bolide; do
  node qa/shot.mjs "?screen=garage&car=$c&q=low&pose=0.7" "$O/pose-$c" 1500 800 450 > "$O/pose-$c.log" 2>&1; echo "DONE $c" >> $O/batch3.log
done
node qa/shot.mjs "?screen=race&track=canyon&auto=1&q=low&maxdt=0.5&ts=3" "$O/canyon2" 8000,30000 1280 720 > "$O/canyon2.log" 2>&1; echo "DONE canyon2" >> $O/batch3.log
node qa/shot.mjs "?screen=boss&auto=1&q=low&maxdt=0.5&ts=2" "$O/boss2" 12000,40000 1280 720 > "$O/boss2.log" 2>&1; echo "DONE boss2" >> $O/batch3.log
echo ALL_DONE >> $O/batch3.log
