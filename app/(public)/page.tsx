import { Hero } from "@/components/landing/hero";
import { Intro } from "@/components/landing/intro";
import { Categories } from "@/components/landing/categories";
import { Featured } from "@/components/landing/featured";
import { WhyParticipate } from "@/components/landing/why-participate";
import { Journey } from "@/components/landing/journey";
import { ImportantInfo, FinalCta } from "@/components/landing/info-cta";
import { getActivePriceWindows, getFeaturedEvents } from "@/lib/data/events";
import { getMyRegisteredEventIds } from "@/lib/data/registrations";
import { getLandingContent } from "@/lib/data/settings";

export default async function LandingPage() {
  const [featured, registeredIds, content] = await Promise.all([
    getFeaturedEvents(4),
    getMyRegisteredEventIds(),
    getLandingContent(),
  ]);
  const priceWindows = await getActivePriceWindows(featured.map((e) => e.id));

  return (
    <>
      {/* Reviewed public marketing copy: visible in masked replay (D-024). */}
      <div className="contents" data-ph-unmask>
        <Hero hero={content.hero} />
        <Intro intro={content.intro} />
        <Categories categories={content.categories} />
      </div>
      <Featured
        events={featured}
        registeredIds={registeredIds}
        featured={content.featured}
        priceWindows={priceWindows}
      />
      <div className="contents" data-ph-unmask>
        <WhyParticipate why={content.why} />
        <Journey journey={content.journey} />
        <ImportantInfo info={content.info} />
        <FinalCta finalCta={content.finalCta} />
      </div>
    </>
  );
}
