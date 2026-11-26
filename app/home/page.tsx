import { Dashboard } from "@/components/Dashboard";

/**
 * Existing Intrisal product surface.
 * Inline hold: if we just left the landing page, hide chrome before React hydrates
 * so Open platform never flashes the UI then re-animates it.
 */
export default function ProductHomePage() {
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{if(sessionStorage.getItem("intrisal-from-landing")==="1"){document.documentElement.dataset.platformEnter="1";}}catch(e){}})();`,
        }}
      />
      <Dashboard />
    </>
  );
}
