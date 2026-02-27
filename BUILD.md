Review and diagnose an issue with the raise and lower backend/lib/ebb-serial.js logic. Something is off with the servo sweep timing (it's a V2_V3 servo) or there's another deeper issue. The logs for lowering and raising look correct, but in reality this happens:
 - On init, we assume the pen is up (AFAIK this is assumed to be true, but was recently changed as we were sending a raise pen command on every init. I've changed it back and forth and the issue persists)
 - On init we configure our servos (which I think is done correctly, but very well could be the problem area since it seems to be a pulse width timing issue)
 - We POST to /api/pen/down or send a pen down message and:
   - The logs look correct (SP,0,59,2) (where 59 is the delay we calculate)
   - The following heartbeat logs the pen in a down state - so the hardware thinks it's down
   - But the pen doesn't go down. We wait almost a minute, and the pen finally goes down.

Attempts to remedy the situation:
 1. Removing/reducing the query general 2s intervals - thinking it was too much for the serial - did not resolve
 2. Tried manually setting internal servo move calculation to 59 or 62 - did not resolved
 3. When the process is C-C'd, all we do us disable the motors, possibly leaving the servo down, so I tried to add a penUp on the sigint - did not resolve
 4. So I went ahead and ebb-motion's constructor to initialize in an up state - did not resolve
 5. I then found in the EBB documentation that on 5v servos they're set down when power is off, but with the narrow band servo this may not be true. It has its own power supply (a computer + a wall adapter.) I don't think this is the cause either, it feels like a PWM issue.
 
There's a good chance we're getting out of sync with the amount of (new, I think good) Query General calls - I think the servo's internal isUp gets out of sync with the parent axidraw's polling, so it would be helpful to just do a thorough do-over and check of how this is all built.
 
[References relating to servos/pwm]
./ebb/servo.md
./ebb/faq.md
./ebb/EggBot-ebb.md (contains both of above)
./backend/lib/ebb-servo.js - all the NB values e.g.:
```
* - Narrow-band (penlift=3): Pin B2, 0.45-1.05ms pulse, 70ms sweep
I'm not sure if this is 100% reliable information (as are the 7200 values, and our delay caluclations, those may have just been guesses)
```
