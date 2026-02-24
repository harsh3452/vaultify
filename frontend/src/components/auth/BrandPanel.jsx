import { HardDrive, Brain, FolderOpen, Shield, FileCheck } from "lucide-react";

const BrandPanel = () => (
  <div className="hidden lg:flex flex-col justify-center w-[48%] bg-gradient-to-br from-teal-600 to-teal-700 text-white p-12 relative overflow-hidden">
    {/* Decorative circles */}
    <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-white/5" />
    <div className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full bg-white/5" />

    <div className="relative z-10">
      <div className="flex items-center gap-2.5 mb-8">
        <HardDrive size={22} />
        <span className="text-base font-extrabold tracking-[3px]">VAULTIFY</span>
      </div>

      <h1 className="text-[1.75rem] font-extrabold leading-tight mb-4">
        AI-Powered Document Sorting for Professionals
      </h1>
      <p className="text-white/70 text-sm leading-relaxed mb-8">
        Upload client documents and let AI classify, sort, and organize them
        instantly. Built for LIC agents, CAs, and financial professionals.
      </p>

      <ul className="space-y-3">
        {[
          { icon: Brain, text: "AI classifies PAN, Aadhar, Voter ID, Driving License & more" },
          { icon: FolderOpen, text: "Auto-organizes by client name and document type" },
          { icon: Shield, text: "Secure cloud storage with Firebase" },
          { icon: FileCheck, text: "Download as JPG or PDF anytime" },
        ].map(({ icon: Icon, text }, i) => (
          <li key={i} className="flex items-start gap-3 text-sm text-white/80">
            <Icon size={18} className="mt-0.5 shrink-0 text-white/90" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  </div>
);

export default BrandPanel;
