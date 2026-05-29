import { useRef } from "react";
import { randomUUID } from "src/utils/uuid";

const useUID = () => {
	const uidRef = useRef<string>(randomUUID());
	return uidRef.current;
};

export default useUID;
