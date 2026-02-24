import BrandPanel from "./BrandPanel";

const AuthLayout = ({ children }) => (
  <div className="flex min-h-screen w-full">
    <BrandPanel />
    <div className="flex flex-1 items-center justify-center p-6 sm:p-10 bg-muted/30">
      <div className="w-full max-w-md">{children}</div>
    </div>
  </div>
);

export default AuthLayout;
