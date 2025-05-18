const fs = require("fs");
const express = require("express"); 
const path = require("path");
const bodyParser = require("body-parser"); 
const app = express(); 
const portNumber = process.env.PORT || 4000;
process.stdin.setEncoding("utf8");

app.use(bodyParser.urlencoded({extended:false}));
app.set("view engine", "ejs");
app.set("views", path.resolve(__dirname, "templates"));
app.use(express.static(__dirname));

//require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");

let args = (process.argv);

if (args.length != 2) {
    console.log("Usage node ./songSummarizer.js");
} else {
    console.log(`Web server started and running at http://localhost:${portNumber}`); 
    app.listen(portNumber);
    console.log('Stop to shutdown the server: ');

    process.stdin.on('readable', () => {
        let args = (process.argv);
    
        let dataInput = process.stdin.read();
        if (dataInput !== null) {
            let command = dataInput.trim();
            if (command === "stop") {
                process.stdout.write("Shutting down the server");
                process.exit(0) 
            } else {
                process.stdout.write(`Invalid command: ${command}`);
                process.stdin.resume();
                console.log('\nStop to shutdown the server: ');
            }
        }
    });
}


app.get("/", (request, response) => {
    response.render("index");
});


app.post("/Summarize", (request, response) => {
    let {artistName, songName, saveEntry, folderName} =  request.body;

    async function summarize(artist, songTitle) {
        const query = `${artist} ${songTitle}`;
        const apiUrl = `https://api.genius.com/search?q=${encodeURIComponent(query)}`;

        const res = await fetch(apiUrl, {
            headers: {
                Authorization: `Bearer ${process.env.GENIUS_API_TOKEN}`
            }
        });

        const data = await res.json();

        const song = data.response.hits.find(hit =>
            hit.result.primary_artist.name.toLowerCase() === artist.toLowerCase()
        );

        if (!song) {
            return "Invalid Query, try again";
        }

        const songId = song.result.id;

        const getDescriptionURL = `https://api.genius.com/songs/${songId}?text_format=plain`;
        const descrRes = await fetch(getDescriptionURL, {
            headers: {
                Authorization: `Bearer ${process.env.GENIUS_API_TOKEN}`
            }
        });

        const songIDData = await descrRes.json();
        const description = songIDData.response.song.description.plain;
        return description
    } 
    
    summarize(artistName, songName).then(desc => {
        let summary = desc

        if (saveEntry == "yes") {

            const databaseName = process.env.MONGO_DB_NAME;
            const collectionName = process.env.MONGO_COLLECTION;
            const uri = process.env.MONGO_CONNECTION_STRING;
            const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1 });

            const insertDB = (async () => {
                try {
                    await client.connect();
                    const database = client.db(databaseName);
                    const collection = database.collection(collectionName);
                    const entry = {folder: folderName, artist: artistName, song: songName, description: summary};

                    const docExists = await collection.findOne(entry)

                    if (!docExists && summary != "Invalid Query, try again") {
                        let result = await collection.insertOne(entry);
                    }
                } catch (e) {
                    console.error(e);
                } finally {
                    await client.close();
                }
            });

            insertDB();
        }

        const variables = {
            artist: artistName,
            song: songName,
            displaySongSummary: summary,
        };
        response.render("showSongSummary", variables);
    })
});

app.get("/ListSummaries", (request, response) => {
    response.render("listSummaries");
});

app.post("/ListSummaries", (request, response) => {
    let {displayFromFolder} =  request.body;

    (async () => {
        const databaseName = process.env.MONGO_DB_NAME;
        const collectionName = process.env.MONGO_COLLECTION;
        const uri = process.env.MONGO_CONNECTION_STRING;
        const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1 });

        try {
            await client.connect();
            const database = client.db(databaseName);
            const collection = database.collection(collectionName);

            const filter = {folder: displayFromFolder};
            cursor = collection.find(filter);
            result = await cursor.toArray();

            allSummaries = "<table border = 1><thead><tr><th>Artist</th><th>Song</th><th>Summary</th></tr></thead><tbody>"

            for (let i = 0; i < result.length; i++) {
                let currDoc = result[i]
                allSummaries += "<tr>";
                allSummaries += `<td>${currDoc.artist}</td>`;
                allSummaries += `<td>${currDoc.song}</td>`;
                allSummaries += `<td>${currDoc.description}</td>`;
                allSummaries += "</tr>";
            }

            allSummaries += "</tbody></table>";

            const variables = {
                folder: displayFromFolder,
                songSummaryTable: allSummaries
            }

            response.render("displayListSummaries", variables);

        } catch (e) {
            console.error(e);
        } finally {
            await client.close();
        }
    })();
});

app.get("/DeleteSummaries", (request, response) => {
    const variables = {
        deletionConfirmation: ""
    }

    response.render("deleteSummaries", variables);
});

app.post("/DeleteSummaries", (request, response) => {
    let {specifyDeleteFolder, deleteAllFolder, deleteArtist, deleteSong} =  request.body;

    (async () => {
        const databaseName = process.env.MONGO_DB_NAME;
        const collectionName = process.env.MONGO_COLLECTION;
        const uri = process.env.MONGO_CONNECTION_STRING;
        const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1 });

        try {
            await client.connect();
            const database = client.db(databaseName);
            const collection = database.collection(collectionName);
            let filter;
            let confirmation;

            if (deleteAllFolder == "yes") {
                filter = {folder: specifyDeleteFolder}; 

                const docExists = await collection.findOne(filter)

                if (docExists) {
                    confirmation = `Deleted all song summaries in folder ${specifyDeleteFolder}`
                    await collection.deleteMany(filter);
                } else {
                    confirmation = `Folder ${specifyDeleteFolder} does not exist`
                }           

            } else {
                if (!deleteSong) {
                    filter = {folder: specifyDeleteFolder, artist: deleteArtist}; 
                    const docExists = await collection.findOne(filter)

                    if (docExists) {
                        confirmation = `Deleted all song summaries in folder ${specifyDeleteFolder} by artist ${deleteArtist}`
                        await collection.deleteMany(filter);
                    } else {
                        confirmation = `Songs by artist ${deleteArtist} does not exist in folder ${specifyDeleteFolder} `
                    }

                } else {
                    filter = {folder: specifyDeleteFolder, artist: deleteArtist, song: deleteSong}; 
                    const docExists = await collection.findOne(filter)

                    if (docExists) {
                        confirmation = `Deleted song summary for ${deleteSong} by artist ${deleteArtist} in folder ${specifyDeleteFolder}`
                        await collection.deleteOne(filter);
                    } else {
                        confirmation = `Song ${deleteSong} by artist ${deleteArtist} does not exist in folder ${specifyDeleteFolder} `
                    }
                }
            }

            const variables = {
                deletionConfirmation: confirmation
            }

            response.render("deleteSummaries", variables);
        } catch (e) {
            console.error(e);
        } finally {
            await client.close();
        }
    })();
});