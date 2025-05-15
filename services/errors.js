function useDebouncedValue(value, delay) { // custom hook
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
        const handler = setTimeout(() => setDebouncedValue(value), delay);

        return () => clearTimeout(handler);
    }, [value, delay]);

    return debouncedValue;
}
// use the above custom hook in a component like this
const debouncedSearch = useDebouncedValue(search, 700);

useEffect(() => {
    if (debouncedSearch) {
        dispatch(fetchSearchMoviesAction(debouncedSearch));
    } else {
        dispatch(resetSearchedMovies());
    }
}, [debouncedSearch, dispatch]);
