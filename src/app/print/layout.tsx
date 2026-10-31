import { PrintBar } from "@/components/PrintBar";

export const dynamic = "force-dynamic";

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen pb-10">
      <PrintBar />
      <div className="mx-auto max-w-[820px] rounded-xl border border-line bg-white p-8 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none md:p-12">{children}</div>
    </div>
  );
}
