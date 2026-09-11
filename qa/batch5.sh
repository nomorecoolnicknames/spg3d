#!/bin/bash
O=/mnt/ramdisk/spg-shots; : > $O/batch5.log
node qa/shot-touch.mjs > $O/touch.log 2>&1; echo "DONE touch $?" >> $O/batch5.log
echo ALL_DONE >> $O/batch5.log
