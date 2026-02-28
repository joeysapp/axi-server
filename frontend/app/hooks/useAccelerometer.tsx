import { useState, useEffect, useRef, useCallback } from "react";

export function useAccelerometer() {
	const [velocity, setVelocity] = useState({ x: 0, y: 0, z: 0 });
	const [acceleration, setAcceleration] = useState({ x: 0, y: 0, z: 0 });
	const [error, setError] = useState<string | null>(null);
	const [isSupported, setIsSupported] = useState<boolean>(false);
	const [permissionGranted, setPermissionGranted] = useState<boolean>(false);
	
	const lastTimestamp = useRef<number>(0);
	const lastVelocity = useRef({ x: 0, y: 0, z: 0 });

	const requestPermission = useCallback(async () => {
		if (
			typeof DeviceMotionEvent !== "undefined" &&
			typeof (DeviceMotionEvent as any).requestPermission === "function"
		) {
			try {
				const response = await (DeviceMotionEvent as any).requestPermission();
				setPermissionGranted(response === "granted");
				return response === "granted";
			} catch (e) {
				setError("Permission request failed");
				return false;
			}
		} else {
			setPermissionGranted(true);
			return true;
		}
	}, []);

	useEffect(() => {
		if (
			typeof window === "undefined" ||
			typeof window.DeviceMotionEvent === "undefined"
		) {
			setIsSupported(false);
			return;
		}

		setIsSupported(true);

		const handleMotion = (event: DeviceMotionEvent) => {
			const accData = event.accelerationIncludingGravity || event.acceleration;
			if (!accData) return;

			setAcceleration({
				x: accData.x || 0,
				y: accData.y || 0,
				z: accData.z || 0,
			});

			// Simple integration for velocity (drifty but works for relative motion)
			const currentTimestamp = performance.now();
			if (lastTimestamp.current !== 0) {
				const deltaTime = (currentTimestamp - lastTimestamp.current) / 1000;
				lastVelocity.current = {
					x: lastVelocity.current.x + (accData.x || 0) * deltaTime,
					y: lastVelocity.current.y + (accData.y || 0) * deltaTime,
					z: lastVelocity.current.z + (accData.z || 0) * deltaTime,
				};
				setVelocity({ ...lastVelocity.current });
			}
			lastTimestamp.current = currentTimestamp;
		};

		if (permissionGranted) {
			window.addEventListener("devicemotion", handleMotion);
		}

		return () => {
			window.removeEventListener("devicemotion", handleMotion);
		};
	}, [permissionGranted]);

	return { velocity, acceleration, error, isSupported, permissionGranted, requestPermission };
}

export default useAccelerometer;
