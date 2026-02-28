import { useState, useEffect } from "react";

export function useDeviceOrientation() {
	const [orientation, setOrientation] = useState({
		alpha: null,
		beta: null,
		gamma: null,
		unsupported: false,
	});
	useEffect(() => {
		if (!window.DeviceOrientationEvent) {
			setOrientation((prevOrientation) => ({
				...prevOrientation,
				unsupported: true,
			}));
			return;
		}
		const handleOrientation = (event) => {
			setOrientation({
				alpha: event.alpha,
				beta: event.beta,
				gamma: event.gamma,
				unsupported: false,
			});
		};
		window.addEventListener("deviceorientation", handleOrientation);
		return () => {
			window.removeEventListener("deviceorientation", handleOrientation);
		};
	}, []);
	return orientation;
}
export default useDeviceOrientation;
