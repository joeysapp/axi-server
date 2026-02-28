import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ActionIcon, Group, Stack, Text, Tooltip,
  Drawer, Divider, UnstyledButton, Badge, TextInput
} from "@mantine/core";
import {
  Settings, PenTool, ChevronUp, ChevronDown,
  Layers, Zap, Activity, Power, X, Users
} from "lucide-react";
import { useWebSocketActions, useWebSocketState } from "~/contexts/WebSocketProvider";
import { websocketStore } from "~/stores/websocket";
import { Joystick } from "./Joystick";
import { AxiConfig } from "./AxiConfig";
import { AxiQueue } from "./AxiQueue";
import { AxiStatus } from "./AxiStatus";
import classes from "../styles/Glass.module.scss";

export const LiquidDock = () => {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState("controls"); // controls | queue
  const [configOpened, setConfigOpened] = useState(false);
  const [hostInput, setHostInput] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("axiApiHost") || "" : ""
  );
  const [nameInput, setNameInput] = useState("");

  const state = useWebSocketState();
  const { penToggle, penUp, penDown, home, stop, sendSpatial, emit, setName } = useWebSocketActions();

  const clientCount = 1 + Object.keys(state.remoteClients).length;
  const inControl = state.clientId !== null && state.clientId === state.controllerId;

  const handleJoystickMove = (x: number, y: number) => {
    const speed = 100; // base speed
    sendSpatial({
      velocity: { x: x * speed, y: -y * speed, z: 0 }
    });
  };

  const handleJoystickStop = () => {
    sendSpatial({
      velocity: { x: 0, y: 0, z: 0 }
    });
  };

  const handleHostChange = () => {
    const trimmed = hostInput.trim();
    if (trimmed) {
      localStorage.setItem("axiApiHost", trimmed);
    } else {
      localStorage.removeItem("axiApiHost");
    }
    // Reconnect
    websocketStore.disconnect();
    const baseHost = trimmed || window.location.origin;
    const wsHost = baseHost.replace(/^http/, "ws");
    const wsUrl = wsHost.endsWith("/spatial") ? wsHost : `${wsHost}/spatial`;
    websocketStore.connect(wsUrl);
  };

  const handleNameSubmit = () => {
    const trimmed = nameInput.trim();
    if (trimmed) {
      setName(trimmed);
    }
  };

  const toggleExpand = () => setExpanded(!expanded);

  return (
    <>
      <div
        style={{
          position: "fixed",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
          pointerEvents: "none"
        }}
      >
        <motion.div
          layout
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 25 }}
          className={classes.dock}
          style={{
            width: expanded ? "auto" : "fit-content",
            height: expanded ? "auto" : 56,
            borderRadius: expanded ? 32 : 28,
            flexDirection: expanded ? "column" : "row",
            padding: expanded ? "16px 24px" : "8px 16px",
            minWidth: expanded ? 320 : 160,
          }}
        >
          {/* Status Pill (always visible or part of the idle state) */}
          {!expanded && (
            <UnstyledButton onClick={toggleExpand} style={{ pointerEvents: "auto", display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: state.serverConnected ? "#4ecca3" : "#ff4d4d",
                  boxShadow: `0 0 10px ${state.serverConnected ? "#4ecca3" : "#ff4d4d"}`,
                }}
              />
              <Text size="sm" fw={600} style={{ letterSpacing: 1, color: inControl ? '#4ecca3' : state.serverConnected ? '#888' : '#ff4d4d' }}>
                AXI-LAB{state.serverConnected ? ` (${clientCount})` : " • OFFLINE"}
                {state.serverConnected && !inControl && " • OBSERVING"}
              </Text>
            </UnstyledButton>
          )}

          {/* Expanded Content */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                style={{ width: "100%", pointerEvents: "auto" }}
              >
                <Group justify="space-between" mb="md">
                   <Group gap="xs">
                      <UnstyledButton
                        onClick={() => setActiveTab("controls")}
                        style={{ color: activeTab === 'controls' ? '#4ecca3' : '#888', fontWeight: 600, fontSize: 12 }}
                      >
                        CONTROLS
                      </UnstyledButton>
                      <Divider orientation="vertical" size="xs" />
                      <UnstyledButton
                        onClick={() => setActiveTab("queue")}
                        style={{ color: activeTab === 'queue' ? '#4ecca3' : '#888', fontWeight: 600, fontSize: 12 }}
                      >
                        QUEUE
                      </UnstyledButton>
                   </Group>
                   <Group gap="xs">
                    <ActionIcon variant="subtle" color="gray" onClick={() => setConfigOpened(true)}>
                      <Settings size={18} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" color="gray" onClick={toggleExpand}>
                      <X size={18} />
                    </ActionIcon>
                   </Group>
                </Group>

                {activeTab === 'controls' && (
                  <Stack gap="lg">
                    <Group justify="space-around" align="center">
                      <Joystick onMove={handleJoystickMove} onStop={handleJoystickStop} />
                      <Stack gap="xs">
                         <Tooltip label="Toggle Pen">
                            <motion.button
                              whileTap={{ scale: 0.9 }}
                              onClick={penToggle}
                              style={{
                                width: 56,
                                height: 56,
                                borderRadius: "50%",
                                border: "none",
                                background: state.penDown ? "#ff4d4d" : "rgba(255,255,255,0.05)",
                                color: state.penDown ? "white" : "#4ecca3",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                boxShadow: state.penDown ? "0 0 20px rgba(255, 77, 77, 0.4)" : "none"
                              }}
                            >
                              <PenTool size={24} />
                            </motion.button>
                         </Tooltip>
                         <Group gap="xs">
                            <ActionIcon variant="light" color="blue" onClick={penUp} size="lg" radius="xl">
                               <ChevronUp size={20} />
                            </ActionIcon>
                            <ActionIcon variant="light" color="red" onClick={penDown} size="lg" radius="xl">
                               <ChevronDown size={20} />
                            </ActionIcon>
                         </Group>
                      </Stack>
                    </Group>

                    <Group grow gap="xs">
                       <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={home}
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "#eee",
                          padding: "8px",
                          borderRadius: "12px",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: "pointer"
                        }}
                       >
                         HOME
                       </motion.button>
                       <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={stop}
                        style={{
                          background: "rgba(255, 77, 77, 0.1)",
                          border: "1px solid rgba(255, 77, 77, 0.2)",
                          color: "#ff4d4d",
                          padding: "8px",
                          borderRadius: "12px",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: "pointer"
                        }}
                       >
                         STOP
                       </motion.button>
                    </Group>
                  </Stack>
                )}

                {activeTab === 'queue' && (
                  <div style={{ maxHeight: 300, overflow: 'auto' }}>
                     <AxiQueue />
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      <Drawer
        opened={configOpened}
        onClose={() => setConfigOpened(false)}
        title="Hardware Configuration"
        position="right"
        size="md"
        styles={{
          content: { background: 'rgba(10, 10, 10, 0.8)', backdropFilter: 'blur(20px)', color: 'white' },
          header: { background: 'transparent', color: 'white' }
        }}
      >
        <Stack gap="md">
           <AxiStatus />
           <Divider />

           {/* Server URL */}
           <Text size="xs" fw={600} c="dimmed" tt="uppercase">Server URL</Text>
           <Group gap="xs">
             <TextInput
               placeholder="http://localhost:9700"
               value={hostInput}
               onChange={(e) => setHostInput(e.currentTarget.value)}
               onKeyDown={(e) => e.key === 'Enter' && handleHostChange()}
               styles={{
                 input: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' },
               }}
               style={{ flex: 1 }}
             />
             <UnstyledButton
               onClick={handleHostChange}
               style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(78, 204, 163, 0.15)', color: '#4ecca3', fontSize: 12, fontWeight: 600 }}
             >
               Connect
             </UnstyledButton>
           </Group>

           <Divider />

           {/* Display Name */}
           <Text size="xs" fw={600} c="dimmed" tt="uppercase">Display Name</Text>
           <Group gap="xs">
             <TextInput
               placeholder={state.clientId || "Your name"}
               value={nameInput}
               onChange={(e) => setNameInput(e.currentTarget.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') handleNameSubmit(); }}
               styles={{
                 input: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' },
               }}
               style={{ flex: 1 }}
             />
             <UnstyledButton
               onClick={handleNameSubmit}
               style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(78, 204, 163, 0.15)', color: '#4ecca3', fontSize: 12, fontWeight: 600 }}
             >
               Set
             </UnstyledButton>
           </Group>

           <Divider />

           {/* Connected Clients */}
           <Group gap="xs" align="center">
             <Users size={14} color="#4ecca3" />
             <Text size="xs" fw={600} c="dimmed" tt="uppercase">Connected Clients ({clientCount})</Text>
           </Group>
           <Stack gap={4}>
             {/* Self */}
             <Group gap="xs">
               <div style={{
                 width: 8, height: 8, borderRadius: '50%',
                 background: state.clientColor || '#4ecca3',
                 boxShadow: `0 0 6px ${state.clientColor || '#4ecca3'}`,
               }} />
               <Text size="sm" c="white">
                 {state.clientId || 'you'} (you){inControl ? ' — in control' : ''}
               </Text>
             </Group>
             {/* Remote clients */}
             {Object.values(state.remoteClients).map((client) => (
               <Group gap="xs" key={client.id}>
                 <div style={{
                   width: 8, height: 8, borderRadius: '50%',
                   background: client.color,
                   boxShadow: `0 0 6px ${client.color}`,
                 }} />
                 <Text size="sm" c="white">
                   {client.name}{client.id === state.controllerId ? ' — in control' : ''}
                 </Text>
               </Group>
             ))}
           </Stack>

           <Divider />
           <AxiConfig />
           <Divider />
           <Group grow>
              <UnstyledButton
                onClick={() => emit("connect")}
                style={{ padding: 12, borderRadius: 8, background: 'rgba(78, 204, 163, 0.1)', color: '#4ecca3', textAlign: 'center' }}
              >
                <Power size={14} style={{ marginRight: 8 }} /> Connect
              </UnstyledButton>
              <UnstyledButton
                onClick={() => emit("disconnect")}
                style={{ padding: 12, borderRadius: 8, background: 'rgba(255, 77, 77, 0.1)', color: '#ff4d4d', textAlign: 'center' }}
              >
                Disconnect
              </UnstyledButton>
           </Group>
        </Stack>
      </Drawer>
    </>
  );
};
