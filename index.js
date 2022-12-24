const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');
const port = 5000;
const nodemailer = require('nodemailer');
const sgTransport = require('nodemailer-sendgrid-transport');

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dcsevxy.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'unAthorized access' })
    }

    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' });
        }
        req.decoded = decoded;
        next();
    });
}


// nodemailer sendgrid
const emailSenderOptions = {
    auth: {
        api_key: process.env.EMAIL_SENDER_KEY
    }
}
const mailer = nodemailer.createTransport(sgTransport(emailSenderOptions));

function sendAppointmentEmail(booking) {
    const { patientEmail, patientName, date, slot, treatment } = booking; 

    var email = {
        from: process.env.SENDER_EMAIL,
        to: patientEmail || process.env.SENDER_EMAIL, 
        subject: `your appointment for ${treatment} is on ${date} at ${slot}`,
        text: `your appointment for ${treatment} is on ${date} at ${slot}`,
        html: `
        <div>
            <p>Hello ${patientName}</p>
            <h3>your appointment for ${treatment} is confirmed</h3>
            <p>looking forward to seeing you on ${date} at ${slot}</p>

            <h3>our address</h3>
            <p>andor killa bandorban</p>
        </div>
        `
    };

    mailer.sendMail(email, function (err, res) {
        if (err) {
            console.log(err)
        }
        console.log(res);
    });
}


async function run() {
    try {
        await client.connect();

        const serviceCollection = client.db('Drs_Care').collection('services');
        const bookingCollection = client.db('Drs_Care').collection('bookings');
        const userCollection = client.db('Drs_Care').collection('users');
        const doctorCollection = client.db('Drs_Care').collection('doctors');


        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            }
            else {
                return res.status(403).send({ message: 'forbidden access' });
            }
        }


        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query).project({ name: 1 });
            const result = await cursor.toArray();
            res.send(result);
        })

        app.get('/available', async (req, res) => {
            const date = req.query.date || "Dec 17, 2022";

            // get All services
            const services = await serviceCollection.find().toArray();

            // bookings of the day
            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();

            services.forEach(service => {
                const serviceBookings = bookings.filter(book => book.treatment === service.name);
                const bookedSlot = serviceBookings.map(book => book.slot);
                const available = service.slots.filter(slot => !bookedSlot.includes(slot));
                service.slots = available;
            })

            res.send(services);
        })

        app.get('/booking', verifyJWT, async (req, res) => {
            const patientEmail = req.query.patient;
            const decodedEmail = req.decoded.email;
            if (decodedEmail === patientEmail) {
                const query = { patientEmail };
                const result = await bookingCollection.find(query).toArray();
                return res.send(result);
            }
            else {
                return res.status(403).send({ message: 'forbidden access' });
            }

        })


        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        })

        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin });
        })

        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' }
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            return res.send({ result });
        })

        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);

            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ result, token });
        })

        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patientEmail: booking.patientEmail };
            const exist = await bookingCollection.findOne(query);
            if (exist) {
                return res.send({ success: false, booking: exist })
            }
            const result = await bookingCollection.insertOne(booking); 
            sendAppointmentEmail(booking);
            return res.send({ success: true, result });
        })


        app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = await doctorCollection.find().toArray();
            res.send(doctor);
        })

        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor);
            res.send(result);
        })

        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email; 
            const filter = { email: email }
            const result = await doctorCollection.deleteOne(filter);
            res.send(result);
        })
    }
    finally {

    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('hello world')
})

app.listen(port, () => {
    console.log(`server listen on ${port}`)
})