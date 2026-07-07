import { useUiStore } from "./store/uiStore";
import ArenaScreen from "./ui/ArenaScreen";
import ReplayScreen from "./ui/ReplayScreen";
import ReplaysScreen from "./ui/ReplaysScreen";
import SetupScreen from "./ui/SetupScreen";

export default function App() {
  const view = useUiStore((s) => s.view);
  switch (view) {
    case "arena":
      return <ArenaScreen />;
    case "replays":
      return <ReplaysScreen />;
    case "replay":
      return <ReplayScreen />;
    default:
      return <SetupScreen />;
  }
}
