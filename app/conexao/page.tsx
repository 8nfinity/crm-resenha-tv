import { AccountsPanel } from "@/components/accounts-panel";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function ConexaoPage() {
  return (
    <>
      <div className="scroll-thin flex-1 overflow-y-auto pb-10">
        <PageHeader
          title={"Números\nconectados"}
          subtitle="Conecte um ou vários WhatsApp. A importação começa sozinha ao parear."
        />
        <div className="px-4 sm:px-8">
          <AccountsPanel />
        </div>
      </div>
    </>
  );
}
