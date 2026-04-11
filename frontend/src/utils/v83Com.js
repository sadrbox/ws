// require("./config");
import NodeCache from "node-cache";
import { getDateFromISO } from "src/utils/functions";

export async function getCOMConnectionInstance() {
  const winax = require("winax");
  try {
    const connector = new winax.Object("V83.COMConnector");
    const agent = await connector.ConnectAgent("tcp://server:1540"); // .env
    // agent.AuthenticateAdmin("admin", "Qwe123");

    const clusters = await agent.GetClusters();
    const cluster = clusters[0];
    agent.Authenticate(
      cluster,
      process.env.CLUSTER_ADMIN, // .env
      process.env.CLUSTER_PASS, // .env
    );

    return { agent, cluster };
  } catch (e) {
    console.log("Не удалось подлючить COM-объект. Ошибка : ", e);
    return null;
  }
}

// export const getCOMConnectWorkingProcess = () => {
// 	const winax = require("winax")
// 	try{
// 		const v83ComObject = new winax.Object("V83.COMConnector");
// 		const WorkingInstance = v83ComObject.ConnectWorkingProcess("tcp://server:1540")
// 	}
// }

export async function getClusterInfobases() {
  const arrOfinfobases = [];
  try {
    const { agent, cluster } = await getCOMConnectionInstance();
    const infobases = await agent.GetInfoBases(cluster);
    // const sessionConnections = comInstance.GetConnections(clusters[0]);
    infobases.map((base) => {
      arrOfinfobases.push({ identity: base.Name, desc: base.Descr });
    });
    return arrOfinfobases;
  } catch (e) {
    console.log("Не удалось получить список ИБ. Ошибка: ", e);
  }
}

///////////
export function getClusterSessions() {
  const appid = {
    "1CV8C": "Тонкий клиент",
    Designer: "Конфигуратор",
  };
  const arrOfsessions = [];
  try {
    const { agent, cluster } = getCOMConnectionInstance();
    const sessions = agent.GetSessions(cluster);
    // const sessions = comInstance.GetSessions(cluster);

    sessions &&
      sessions.map((session) => {
        // console.log(session.Process.StartedAt);
        // if (appid[session.AppID] === "Designer") {
        // 	console.log(session.AppID);
        // }
        arrOfsessions.push({
          infobase: session.InfoBase.Name, // надо авторизоваться через AuthenticateAdmin
          // test: appid.,
          app: appid[session.AppID],
          blockedbyls: session.blockedByLS ? true : false,
          startedat: getDateFromISO(session.StartedAt),
          // host: session.Host,
          // ip: session.Process.HostName,
          username: session.UserName,
          // sessionid: session.SessionID,
        });
      });
    return arrOfsessions;
  } catch (e) {
    // console.log("Не удалось получить список активных сессий кластера.", e);
  }
}
