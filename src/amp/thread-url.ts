export function isAmpThreadUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" && url.hostname === "ampcode.com" && /^\/threads\/T-[a-zA-Z0-9-]+$/.test(url.pathname)
		);
	} catch {
		return false;
	}
}
