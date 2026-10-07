import Image from "next/image";

const SIZES = {
  small: { logo: 32, corner: "rounded-lg", name: "text-[1.3rem] max-[349px]:sr-only", gap: "gap-2" },
  large: { logo: 64, corner: "rounded-2xl", name: "text-[2.6rem]", gap: "gap-3.5" },
};

/** The EpiChat mark beside the product name. The name is the page's main heading. */
export function Brand({ size = "small" }: { size?: keyof typeof SIZES }) {
  const { logo, corner, name, gap } = SIZES[size];
  return (
    <div className={`flex items-center ${gap}`}>
      <Image src="/logo.png" alt="" width={logo} height={logo} unoptimized loading="eager" className={corner} />
      <h1 className={`leading-none font-semibold tracking-tight ${name}`}>EpiChat</h1>
    </div>
  );
}
