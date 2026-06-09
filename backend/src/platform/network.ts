import { ProxyAgent, setGlobalDispatcher } from "undici";

let configured = false;

function getProxyUrl(): string | undefined {
  return (
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy
  );
}

export function configureNetwork(): void {
  if (configured) return;
  configured = true;

  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return;

  try {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    console.info(
      JSON.stringify({
        event: "network_proxy_configured",
        proxyUrl: proxyUrl.replace(/\/\/([^:@/]+):([^@/]+)@/, "//***:***@"),
      })
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "network_proxy_configuration_failed",
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}
