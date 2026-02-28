/*
For a PWA in landscape mode, you usually want to convert these to a Quaternion to avoid "Gimbal Lock" when you're flying your tetrahedron around

window.addEventListener('deviceorientation', (event) => {
	const { alpha, beta, gamma } = event;
  
	// Convert degrees to radians
	const euler = new THREE.Euler(
		THREE.MathUtils.degToRad(beta), 
		THREE.MathUtils.degToRad(alpha), 
		-THREE.MathUtils.degToRad(gamma), 
		'YXZ'
	);

	// Apply to your ghost mesh
	myGhostMesh.quaternion.setFromEuler(euler);
	}, true);
  
 */

import { useState, useCallback } from "react";

export const useSensorPermissions = () => {
	const [permissionStatus, setPermissionStatus] = useState("unknown"); // 'granted', 'denied', 'unknown'

	const requestAccess = useCallback(async () => {
		// Check if the browser requires explicit permission (iOS)
		if (
			typeof DeviceOrientationEvent !== "undefined" &&
			typeof DeviceOrientationEvent.requestPermission === "function"
		) {
			try {
				const response = await DeviceOrientationEvent.requestPermission();
				setPermissionStatus(response);
				return response === "granted";
			} catch (error) {
				console.error("DeviceOrientation permission error:", error);
				setPermissionStatus("denied");
				return false;
			}
		} else {
			// Android or desktop (non-iOS) usually doesn't require the requestPermission() call
			setPermissionStatus("granted");
			return true;
		}
	}, []);

	return { permissionStatus, requestAccess };
};
