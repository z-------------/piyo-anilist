import Plugin from "piyo/src/plugin";
import { MessageEmbed } from "discord.js";
import got from "got";
import { compareTwoStrings } from "string-similarity";

type Dictionary = { [key: string]: any };

enum QueryType {
    Any,
    Anime,
    Manga,
    Character,
}

interface Results {
    anime: Dictionary;
    manga: Dictionary;
    characters: Dictionary;
}

async function al(queryInners: string[], variables: Dictionary): Promise<Results> {
    const query = `query ($search: String) {
        ${queryInners.join("\n")}
    }`;
    console.log("graphql query:", query);
    console.log({
        query,
        variables,
    });
    const res = await got.post("https://graphql.anilist.co/", {
        json: {
            query,
            variables,
        },
        responseType: "json",
        headers: {
            "User-Agent": "piyo-anilist/0.0.0",
        },
    });
    const body: Dictionary = res.body;
    console.log("body:", body);
    const data = body["data"];
    return {
        anime: data.anime.results.length ? Object.assign(data.anime.results[0], { _kind: "anime" }) : null,
        manga: data.manga.results.length ? Object.assign(data.manga.results[0], { _kind: "manga" }) : null,
        characters: data.characters.results.length ? Object.assign(data.characters.results[0], { _kind: "character" }) : null,
    };
}

async function search(search: string): Promise<Dictionary> {
    const queryType = getQueryType(search);
    let processedSearch = queryType === QueryType.Any ? search : search.slice(1, -1);

    const queryInners = [];
    if ([QueryType.Any, QueryType.Anime].includes(queryType)) {
        queryInners.push(`
            anime: Page(perPage: 1) {
                results: media(type: ANIME, search: $search) {
                    id
                    type
                    title {
                        native
                        romaji
                    }
                    description
                    coverImage {
                        large
                    }
                }
            }
        `);
    }
    if ([QueryType.Any, QueryType.Manga].includes(queryType)) {
        queryInners.push(`
            manga: Page(perPage: 1) {
                results: media(type: MANGA, search: $search) {
                    id
                    type
                    title {
                        native
                        romaji
                    }
                    description
                    coverImage {
                        large
                    }
                }
            }
        `);
    }
    if ([QueryType.Any, QueryType.Character].includes(queryType)) {
        queryInners.push(`
            characters: Page(perPage: 1) {
                results: characters(search: $search) {
                    id
                    name {
                        native
                        full
                    }
                    age
                    description
                    image {
                        large
                    }
                }
            }
        `);
    }

    let bestResult: [Dictionary, number] = [null, 0];
    const results = await al(queryInners, { search: processedSearch });
    console.log({ results });
    for (const key in results) {
        console.log({ key });
        const result = results[key];
        if (!result) {
            continue;
        }
        const similarity = getSimilarity(search, getNames(result));
        if (similarity > bestResult[1]) {
            bestResult[0] = result;
            bestResult[1] = similarity;
        }
    }
    return bestResult[0];
}

function getQueryType(keywords: string): QueryType {
    if (isEnclosedBy(keywords, "{", "}")) {
        return QueryType.Anime;
    } else if (isEnclosedBy(keywords, "<", ">")) {
        return QueryType.Manga;
    } else if (isEnclosedBy(keywords, "[", "]")) {
        return QueryType.Character;
    } else {
        return QueryType.Any;
    }
}

function isEnclosedBy(s: string, start: string, end: string) {
    return s.startsWith(start) && s.endsWith(end);
}

function getSimilarity(keyword: string, candidate: string[]): number {
    return candidate
        .map(cand => compareTwoStrings(keyword, cand))
        .reduce((c, v) => Math.max(c, v), 0);
}

function getNames(result: Dictionary): string[] {
    const obj = result.title ?? result.name;
    return Object.values(obj);
}

function getUrl(result: Dictionary): string {
    return `https://anilist.co/${result._kind}/${result.id}`;
}

function getDescription(result: Dictionary): string {
    let description = "";
    if (result.age) {
        description += `Age: ${result.age}. `;
    }
    description += stripSpoilers(result.description);
    return description;
}

function stripSpoilers(description: string): string {
    return description.replace(/~!(.|\n)*?!~/g, "").replace(/\n{3,}/g, "\n\n");
}

function getImage(result: Dictionary): string {
    const image = result.image ?? result.coverImage;
    return image.large ?? image.medium;
}

const name = "AniList for piyo";
export const plugin: Plugin = {
    name,
    prefix: "al",
    query: async function(args: string[]): Promise<MessageEmbed> {
        const result = await search(args.join(" "));
        if (!result) {
            throw new Error("No results found.");
        }
        const names = getNames(result);
        return new MessageEmbed()
            .setTitle(`${names[0]} (${names[1]})`)
            .setColor("BLUE")
            .setDescription(getDescription(result))
            .setURL(getUrl(result))
            .setThumbnail(getImage(result))
            .setFooter(name);
    }
};
