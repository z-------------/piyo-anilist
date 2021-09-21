import Plugin from "piyo/src/plugin";
import { MessageEmbed } from "discord.js";
import got from "got";
import { compareTwoStrings } from "string-similarity";

type Dictionary = { [key: string]: any };

async function al(queryInner: string, variables: { [key: string]: any }): Promise<Dictionary> {
    const query = `
query ($query: String) {
    Page(page: 0, perPage: 1) {
        ${queryInner}
    }
}
    `;
    const res = await got.post("https://graphql.anilist.co/", {
        json: {
            query,
            variables,
        },
        responseType: "json",
    });
    const body: Dictionary = res.body;
    console.log(body);
    const pageObj = body["data"]["Page"];
    const key = Object.keys(pageObj)[0]; // "media", "characters", etc.
    const obj = pageObj[key][0];
    if (!obj) {
        return null;
    }
    obj["_kind"] = key;
    return obj;
}

async function search(keywords: string): Promise<Dictionary> {
    const queries = [
        `media(search: $query, sort: POPULARITY_DESC) {
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
        }`,
        `characters(search: $query, sort: FAVOURITES_DESC) {
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
        }`,
        // `staff(search: $query, sort: FAVOURITES_DESC) {
        //     id
        //     name {
        //         native
        //         full
        //     }
        //     image {
        //         large
        //     }
        //     description
        //     favorites
        // }`,
    ];
    let bestResult: [Dictionary, number] = [null, 0];
    for (const query of queries) {
        const result = await al(query, { query: keywords });
        if (!result) {
            continue;
        }
        const names = getNames(result);
        const similarity = getSimilarity(keywords, names);
        if (similarity > bestResult[1]) {
            bestResult[0] = result;
            bestResult[1] = similarity;
        }
    }
    return bestResult[0];
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
    const kind =
        result._kind === "media" ? result.type.toLowerCase()
        : result._kind[result._kind.length - 1] === "s" ? result._kind.slice(0, -1)
        : result._kind;
    return `https://anilist.co/${kind}/${result.id}`;
}

function getDescription(result: Dictionary): string {
    let description = "";
    if (result.age) {
        description += `Age: ${result.age}. `;
    }
    description += result.description;
    return description;
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
