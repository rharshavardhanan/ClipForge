import type { Metadata } from 'next';
import { Space_Grotesk, DM_Sans, JetBrains_Mono, Anton, Bangers, Archivo_Black, Montserrat, Poppins, Inter } from 'next/font/google';
import './globals.css';

// Distinctive pairing — geometric grotesk display + clean humanist body + a real mono for
// paths/logs. Deliberately not Inter/Roboto/Arial.
const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display', display: 'swap' });
const body = DM_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });

// Caption faces — the SAME fonts Remotion burns into clips, so the Style-tab live preview is truthful.
const capAnton = Anton({ subsets: ['latin'], weight: '400', variable: '--cap-anton', display: 'swap' });
const capBangers = Bangers({ subsets: ['latin'], weight: '400', variable: '--cap-bangers', display: 'swap' });
const capArchivo = Archivo_Black({ subsets: ['latin'], weight: '400', variable: '--cap-archivo', display: 'swap' });
const capMontserrat = Montserrat({ subsets: ['latin'], weight: '800', variable: '--cap-montserrat', display: 'swap' });
const capPoppins = Poppins({ subsets: ['latin'], weight: '700', variable: '--cap-poppins', display: 'swap' });
const capInter = Inter({ subsets: ['latin'], weight: '600', variable: '--cap-inter', display: 'swap' });

const captionFontVars = [capAnton, capBangers, capArchivo, capMontserrat, capPoppins, capInter]
  .map((f) => f.variable).join(' ');

export const metadata: Metadata = {
  title: 'ClipForge — local-first clip studio',
  description: 'Turn long videos into human-feeling short-form clips, entirely on your machine.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} ${captionFontVars}`}>
      <body>{children}</body>
    </html>
  );
}
