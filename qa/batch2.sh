#!/bin/bash
O=/mnt/ramdisk/spg-shots; mkdir -p $O
until grep -q ALL_DONE $O/batch.log; do sleep 10; done
: > $O/batch2.log
for c in m5cs supra lancia m8 gt40 bolide; do
  node qa/shot.mjs "?screen=garage&car=$c&q=low" "$O/car-$c" 2500 960 540 > "$O/car-$c.log" 2>&1; echo "DONE $c $?" >> $O/batch2.log
done
node qa/shot.mjs "?screen=menu&q=low" "$O/menu" 2500 1280 720 > "$O/menu.log" 2>&1; echo "DONE menu" >> $O/batch2.log
node qa/shot.mjs "?screen=career&q=low" "$O/career" 2500 1280 720 > "$O/career.log" 2>&1; echo "DONE career" >> $O/batch2.log
node qa/shot.mjs "?screen=quick&q=low" "$O/quick" 2500 1280 720 > "$O/quick.log" 2>&1; echo "DONE quick" >> $O/batch2.log
echo ALL_DONE >> $O/batch2.log
