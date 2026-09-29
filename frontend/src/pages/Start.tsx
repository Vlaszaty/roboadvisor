import { PageHeader } from '../components/ui';
import { FormWizard } from '../intake/FormWizard';

export default function Start() {
  return (
    <>
      <PageHeader
        title="Build your portfolio"
        lead="A few questions about your situation, then you set your own risk level. About three minutes, nothing is stored on our servers."
      />
      <FormWizard />
    </>
  );
}
