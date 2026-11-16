import { Dashboard } from "@/components/shell/dashboard";

// The shell is static and prerendered; data streams in from the API on the client.
export default function Page() {
  return <Dashboard />;
}
