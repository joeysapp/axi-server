import { useState, useEffect, useCallback } from "react";

export function useGyroscope() {
	const [rotationRate, setRotationRate] = useState({ alpha: 0, beta: 0, gamma: 0 });
	const [orientation, setOrientation] = useState({ alpha: 0, beta: 0, gamma: 0 });
	const [isSupported, setIsSupported] = useState(false);
	const [permissionGranted, setPermissionGranted] = useState(false);

	const requestPermission = useCallback(async () => {
		if (
			typeof DeviceOrientationEvent !== "undefined" &&
			typeof (DeviceOrientationEvent as any).requestPermission === "function"
		) {
			try {
				const response = await (DeviceOrientationEvent as any).requestPermission();
				setPermissionGranted(response === "granted");
				return response === "granted";
			} catch (e) {
				return false;
			}
		} else {
			setPermissionGranted(true);
			return true;
		}
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") return;

		if (window.DeviceMotionEvent || window.DeviceOrientationEvent) {
			setIsSupported(true);
		}

		const handleMotion = (event: DeviceMotionEvent) => {
			if (event.rotationRate) {
				setRotationRate({
					alpha: event.rotationRate.alpha || 0,
					beta: event.rotationRate.beta || 0,
					gamma: event.rotationRate.gamma || 0,
				});
			}
		};

		const handleOrientation = (event: DeviceOrientationEvent) => {
			setOrientation({
				alpha: event.alpha || 0,
				beta: event.beta || 0,
				gamma: event.gamma || 0,
			});
		};

		if (permissionGranted) {
			window.addEventListener("devicemotion", handleMotion);
			window.addEventListener("deviceorientation", handleOrientation);
		}

		return () => {
			window.removeEventListener("devicemotion", handleMotion);
			window.removeEventListener("deviceorientation", handleOrientation);
		};
	}, [permissionGranted]);

	return { rotationRate, orientation, isSupported, permissionGranted, requestPermission };
}

export default useGyroscope;
