import Nav from '../components/landing/Nav';
import Hero from '../components/landing/Hero';
import FeatureCards from '../components/landing/FeatureCards';
import PeopleSection from '../components/landing/PeopleSection';
import ProcessSection from '../components/landing/ProcessSection';
import { CTASection, Footer } from '../components/landing/CTASection';

const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white">
      <Nav />
      <Hero />
      <FeatureCards />
      <PeopleSection />
      <ProcessSection />
      <CTASection />
      <Footer />
    </div>
  );
};

export default LandingPage;
