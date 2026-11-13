import { error } from '@sveltejs/kit';
import { pages } from '#lib/nav.ts';
import { getDoc } from '#lib/server/content.ts';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = () => pages.map(({ path }) => ({ path: path.slice(1) }));

export const load: PageServerLoad = ({ params }) => {
	const doc = getDoc(`/${params.path}`);
	if (!doc) error(404, 'Not found');
	return doc;
};
