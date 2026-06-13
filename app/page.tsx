import { BracketStudio } from '@/components/BracketStudio';
import { PyodideProvider } from '@/components/PyodideProvider';
import { PageHeader } from '@/components/ui';

export default function Home() {
	return (
		<div>
			<PageHeader kicker="Tournament bracket sandbox" title="Bracket Studio" />
			<PyodideProvider>
				<BracketStudio />
			</PyodideProvider>
		</div>
	);
}
