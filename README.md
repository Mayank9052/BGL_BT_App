# BTL Application

A full-stack web application consisting of a React + Vite frontend and an ASP.NET Core Web API backend.

## Tech Stack

### Frontend

* React
* Vite
* JavaScript
* CSS / Bootstrap

### Backend

* ASP.NET Core Web API
* Entity Framework Core
* SQL Server

## Features

* Responsive user interface
* RESTful API architecture
* Database integration
* Authentication and authorization
* CRUD operations
* Error handling and validation

## Prerequisites

Make sure the following are installed:

* Node.js (v18+)
* .NET SDK (8.0 or later)
* SQL Server
* Git

## Project Structure

```text
BTL/
├── Frontend/
│   ├── src/
│   ├── public/
│   └── package.json
│
├── Backend/
│   ├── Controllers/
│   ├── Models/
│   ├── Services/
│   ├── Data/
│   ├── Program.cs
│   └── appsettings.json
│
└── README.md
```

## Frontend Setup

Navigate to the frontend directory:

```bash
cd Frontend
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Frontend URL:

```text
http://localhost:5173
```

## Backend Setup

Navigate to the backend directory:

```bash
cd Backend
```

Restore packages:

```bash
dotnet restore
```

Update the database connection string in `appsettings.json`.

Run database migrations:

```bash
dotnet ef database update
```

Start the API:

```bash
dotnet run
```

API URL:

```text
https://localhost:5001
or
http://localhost:5000
```

## Configuration

Update the API base URL in the frontend environment file:

```env
VITE_API_BASE_URL=https://localhost:5001/api
```

## Build

### Frontend

```bash
npm run build
```

### Backend

```bash
dotnet publish -c Release
```

## API Documentation

Swagger is available when running the backend:

```text
https://localhost:5001/swagger
```

## Development Workflow

1. Start SQL Server.
2. Run the ASP.NET Core API.
3. Start the React application.
4. Access the application in the browser.

## Contributors

* Development Team
* QA Team
* Business Team Lead (BTL)

## License

Internal project – not intended for public distribution.
