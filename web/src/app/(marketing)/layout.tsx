import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";

import "./marketing.css";

/** Display face for the wordmark and headlines — engineered, slightly odd,
 *  and nothing like the workspace's system UI font. Used big and sparingly. */
const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});

/** Body face: quiet, wide apertures, holds up at 15px on a black page. */
const body = Instrument_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

/** Everything outside the app itself: the landing page and the two auth
 *  pages. They share one skin (marketing.css) and one type pairing. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-marketing className={`${display.variable} ${body.variable} min-h-screen`}>
      {children}
    </div>
  );
}
