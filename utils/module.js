import os from "os";

function getLocalIP() {
	const interfaces = os.networkInterfaces();

	for (let interfaceName in interfaces) {
		for (let i = 0; i < interfaces[interfaceName].length; i++) {
			const address = interfaces[interfaceName][i];
			if (address.family === "IPv4" && !address.internal) {
				return address.address;
			}
		}
	}

	return null; // В случае, если локальный IP не найден
}

export { getLocalIP };
