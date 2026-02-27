Begin to decouple the frontend and the backend, meaning that the frontend should be able to point its backend connection to another host. Meaning in practice, the response of /ui (the frontend build) will be deployed as a static file remotely, and will point to an instance of the running axi-lab backend.

Frontend seems to be parsing the QG state incorrectly, it shows many things incorrectly. Improve the queryGeneral command to return an object of true/false values for use in the backend in frontend. It will require bit math. Implement a logical value for each kv pair that makes sense (e.g. using booleans true/false, integers as documentation or strings for complete understanding)
The returned status byte consists of the following status bits:
`Bit 	7 	6 	5 	4 	3 	2 	1 	0
Decimal Value 	128 	64 	32 	16 	8 	4 	2 	1
Name 	Limit Switch Triggered 	Power Lost Flag 	PRG 	PEN 	CMD 	MTR1 	MTR2 	FIFO`
Example response  { limit: 0, switch: 0, triggered: 0, power: 0, pen: .. etc. }

## AxiDraw SERIAL STATE + PHYSICAL STATE + LOGICAL STATE PROGRESS
Look at ./ROADMAP-PLUGINS/EggBot-ebb.mdL636. Implement a logical mechanic that allows absolute movement based on where the motors were enabled (a new value tracked and added to /status, used logically, etc.) and provide the usage via REST, WS messaging: `
"HM" — Home or Absolute Move
    Command:HM,StepFrequency[,Position1,Position2]<CR>
    Response (future mode):HM<NL>
...	
The current position at any given moment is stored in the global step counters, and can be read with the QS query. This position does not refer to an absolute position in physical space, but rather the location where the motors were enabled. The global step counters are reset to zero whenever the motors are enabled, disabled, or have their microstep size changed (all via the EM command). The step counter can also be cleared directly by the CS command. 
...` What this means for us is that via tracking initial state, we could (for now) inspect the AxiDraw physically and see our "home" or 0,0 is incorrect because the motors were turned off/on at a non-zeroed-out location, as if often the case with e.g. server restarts or deployments. Consider a helper function usable via endpoint/WS/frontend button around this concept such as post /zero that would disable and enable the motors, causing the EBB to believe it was at 0,0. This could be used for many things, but first case being handling:
1. AxiDraw pen is offline, physically at 100,100
2. Goes online, queries its stepper state and thinks it is at 0,0
3. (New behavior) Behavior for an endpoint and message that allows negative movement if e.g. a force flag is in data, or endpoint is /move-absolute (example, flag seems better but defer to team.) The negative movement will be done using the HM flag with its passed values. The logic involved in how our initialize our logical state and ~are working on~ solving this multi-body desync problem, I believe both axi and spatial state should show as negative on the frontend and status. This is fine. However, when the /zero (or /reset? I don't think reset zeros the motors) is called, everything should go to 0
# Cleanup
Frontend seems to send a handful of additional {0,0,0} spatial state commands:
- Once shortly after initial connection
- Multiple times, after some time after a motion command with the dpad. Likely timeout related
- The query utility command is being fired far too often:
  - 2 : Static, should only be called on init/connect
  - 3 : Should logically only be used during printing or status check (logically checking fifo state) 
  - 6 : Should logically only be used during printing or status check (logically checking fifo state)
