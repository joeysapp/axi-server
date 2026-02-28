import React, { useRef, useState, useEffect } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";

export const Joystick = ({ onMove, onStop }: { onMove: (x: number, y: number) => void, onStop: () => void }) => {
  const constraintsRef = useRef(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  
  // Normalized values (-1 to 1)
  const normX = useTransform(x, [-30, 30], [-1, 1]);
  const normY = useTransform(y, [-30, 30], [-1, 1]);

  useEffect(() => {
    const unsubscribeX = normX.on("change", (latest) => {
      onMove(latest, normY.get());
    });
    const unsubscribeY = normY.on("change", (latest) => {
      onMove(normX.get(), latest);
    });
    return () => {
      unsubscribeX();
      unsubscribeY();
    };
  }, [normX, normY, onMove]);

  const handleDragEnd = () => {
    animate(x, 0, { type: "spring", stiffness: 300, damping: 20 });
    animate(y, 0, { type: "spring", stiffness: 300, damping: 20 });
    onStop();
  };

  return (
    <div 
      ref={constraintsRef}
      style={{
        width: 80,
        height: 80,
        borderRadius: "50%",
        background: "rgba(255, 255, 255, 0.05)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        touchAction: "none",
        border: "1px solid rgba(255,255,255,0.1)"
      }}
    >
      <motion.div
        drag
        dragConstraints={constraintsRef}
        dragElastic={0.1}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: "#4ecca3",
          boxShadow: "0 0 15px rgba(78, 204, 163, 0.5)",
          cursor: "grab",
          x,
          y,
          zIndex: 2
        }}
        whileTap={{ scale: 0.9, cursor: "grabbing" }}
      />
      {/* Visual background axes */}
      <div style={{ position: "absolute", width: "100%", height: "1px", background: "rgba(255,255,255,0.05)" }} />
      <div style={{ position: "absolute", height: "100%", width: "1px", background: "rgba(255,255,255,0.05)" }} />
    </div>
  );
};
