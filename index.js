const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
require('dotenv').config()
const port = process.env.PORT || 5000
const app = express()

const corsOptions = {
    origin: [
        'http://localhost:5173',
        'http://localhost:5174',
        'https://b9a11-jobhorizon.web.app',
    ],
    credentials: true,
    optionSuccessStatus: 200,
}
app.use(cors(corsOptions))
app.use(express.json())
app.use(cookieParser())

// verify jwt middleware
const verifyToken = (req, res, next) => {
    const token = req.cookies?.token
    if (!token) return res.status(401).send({ message: 'unauthorized access' })
    if (token) {
        jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
            if (err) {
                console.log(err)
                return res.status(401).send({ message: 'unauthorized access' })
            }
            req.user = decoded
            next();
        })
    }
}

// MongoDB database
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ahe248t.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const db = client.db("JobHorizonDB");
        const jobsCollection = db.collection('jobs')
        const appliedJobsCollection = db.collection('appliedJobs')


        //Creating JWT Token
        app.post("/jwt", async (req, res) => {
            const user = req.body;
            // console.log("user for token", user);
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET);

            res.cookie("token", token, cookieOptions).send({ success: true });
        });

        //Clearing JWT Token
        app.post("/logout", async (req, res) => {
            const user = req.body;
            // console.log("logging out", user);
            res
                .clearCookie("token", { ...cookieOptions, maxAge: 0 })
                .send({ success: true });
        });

        // API Services
        app.get('/jobs', async (req, res) => {
            const search = req.query.search;
            let query = {}
            if (search) {
                query = {
                    jobTitle: { $regex: search, $options: 'i' }
                }
            }

            const result = await jobsCollection.find(query).toArray();
            res.send(result);
        })

        app.get('/job/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await jobsCollection.findOne(query);
            res.send(result);
        })

        app.put('/job/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const jobData = req.body;
            const JobUserEmail = req.body?.userEmail;
            if (JobUserEmail !== req.user.email) {
                return res.status(403).send({ message: 'Forbidden Access' })
            }
            const query = { _id: new ObjectId(id) };
            const options = { upsert: true }
            const updateDoc = {
                $set: {
                    ...jobData,
                },
            }
            // console.log(jobData);
            const result = await jobsCollection.updateOne(query, updateDoc, options)
            if (result.modifiedCount > 0) {
                return res.status(200).send({ success: true, message: "Job Updated Successfully" })
            }
            else {
                return res.status(404).send({ success: false, message: "Job can't Updated" })
            }
        })

        app.delete('/job/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await jobsCollection.deleteOne(query);
            if (result.deletedCount > 0) {
                return res.status(200).send({ success: true, message: 'Job deleted successfully' });
            }
            else {
                return res.status(404).send({ success: false, message: 'Job Not found or already deleted' });
            }

        })

        app.post('/add-job', verifyToken, async (req, res) => {
            if (!req.user?.email) {
                return res.status(401).send({ message: 'unauthorized access' })
            }
            const jobData = req.body;
            // console.log(jobData);
            const result = await jobsCollection.insertOne(jobData);
            if (result.acknowledged === true) {
                return res.status(200).send({ success: true, message: 'Job Added Successfully' });
            }
            else {
                return res.status(404).send({ success: false, message: 'Internal Error' });
            }
        })

        app.get('/my-jobs/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (req.user?.email !== email) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            const query = { userEmail: email }
            const result = await jobsCollection.find(query).toArray();
            res.send(result);
        })

        app.get('/applied-jobs/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (req.user?.email !== email) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            const filter = req.query.filter;
            let query = {}
            query = { 'application.applicantUserEmail': email }
            if (filter) {
                query.jobCategory = filter

            }
            // console.log(filter, query);

            const result = await appliedJobsCollection.find(query).toArray();
            res.send(result);
        })

        app.post('/apply-job', verifyToken, async (req, res) => {
            if (!req.user?.email) {
                return res.status(401).send({ message: 'Unauthorized Access' })
            }
            const jobData = req.body;
            // Check Duplicate Request
            const query = {
                'application.applicantUserEmail': jobData.application.applicantUserEmail,
                jobId: jobData.jobId,
            }
            const alreadyApplied = await appliedJobsCollection.findOne(query);
            if (alreadyApplied) {
                return res.status(400).send({ message: "You have already applied on this job." })
            }
            const result = await appliedJobsCollection.insertOne(jobData);

            // Increase Applicant Number
            const updateDoc = {
                $inc: { jobApplicantsNumber: 1 }
            }
            const jobQuery = { _id: new ObjectId(jobData.jobId) }
            const updateJobApplicantsNumber = await jobsCollection.updateOne(jobQuery, updateDoc)

            // Result send
            if (result.acknowledged === true && updateJobApplicantsNumber.modifiedCount > 0) {

                return res.status(200).send({ success: true, message: "Job Apply Successful" });
            }
            else {
                return res.status(404).send({ success: false, message: "Job Apply Unsuccessfull" })
            }

        })



        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Your Server is Running');
})

app.listen(port, () => {
    console.log(`Server is running on: http://localhost:${port}/`);
})