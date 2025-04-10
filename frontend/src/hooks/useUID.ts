import { useRef } from "react";
import { crypto } from "src/utils/main.module";

const useUID = () => {
	const uidRef = useRef<string>(crypto.randomUUID());
	return uidRef.current;
};

export default useUID;
