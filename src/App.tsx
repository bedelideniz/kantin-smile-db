import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import Login from "./pages/Login.tsx";
import SuperAdmin from "./pages/SuperAdmin.tsx";
import YoneticiGiris from "./pages/YoneticiGiris.tsx";
import YoneticiPanel from "./pages/YoneticiPanel.tsx";
import KasiyerGiris from "./pages/KasiyerGiris.tsx";
import KasiyerPanel from "./pages/KasiyerPanel.tsx";
import VeliGiris from "./pages/VeliGiris.tsx";
import VeliPanel from "./pages/VeliPanel.tsx";
import VeliYasaklilar from "./pages/VeliYasaklilar.tsx";
import VeliYukle from "./pages/VeliYukle.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />
          <Route path="/admin" element={<SuperAdmin />} />
          <Route path="/yonetici-giris" element={<YoneticiGiris />} />
          <Route path="/yonetici" element={<YoneticiPanel />} />
          <Route path="/kasiyer-giris" element={<KasiyerGiris />} />
          <Route path="/kasiyer" element={<KasiyerPanel />} />
          <Route path="/veli-giris" element={<VeliGiris />} />
          <Route path="/veli" element={<VeliPanel />} />
          <Route path="/veli/yasaklilar" element={<VeliYasaklilar />} />
          <Route path="/veli/yukle" element={<VeliYukle />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
