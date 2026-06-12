import logo from "@/assets/kantinpay-logo.png";

export default function Index() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <img
        src={logo}
        alt="KantinPay"
        className="w-full max-w-3xl h-auto drop-shadow-2xl"
      />
    </div>
  );
}
