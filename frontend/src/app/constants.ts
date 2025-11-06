const LOCAL_API_URL = "http://192.168.1.112:3000/api/v1";
const REMOTE_API_URL = "http://buhprof.ddns.me:3000/api/v1";

// Простая функция определения URL на основе текущего hostname
function getApiUrl() {
	const isLocalNetwork =
		window.location.hostname.includes("192.168.") ||
		window.location.hostname === "localhost" ||
		window.location.hostname === "127.0.0.1";

	return isLocalNetwork ? LOCAL_API_URL : REMOTE_API_URL;
}

// Текущий URL для экспорта
const API_BASE_URL = getApiUrl();

export { API_BASE_URL, LOCAL_API_URL, REMOTE_API_URL, getApiUrl };

// const API_BASE_URL = "http://192.168.1.112:3000/api/v1";

// export { API_BASE_URL };

// export const API_BASE_URL = process.env.REACT_APP_API_BASE_URL;
