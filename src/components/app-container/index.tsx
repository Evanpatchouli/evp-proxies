import styles from "./index.module.css";

export default function AppContainer(props: { children?: React.ReactNode }) {
  return <div className={styles["app-container"]}>{props.children}</div>;
}
